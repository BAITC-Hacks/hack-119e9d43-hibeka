"""Bounded, read-only tools for one immutable analysis snapshot."""
from collections import Counter, deque
from datetime import date
from functools import lru_cache
from math import fsum
from typing import Literal

import pyarrow.parquet as pq
from pydantic import BaseModel, ConfigDict, Field

from backend.app.runs import get_run, read_analysis, snapshot

Role = Literal['consolidator', 'transit', 'distributor', 'terminal', 'coordinator', 'peripheral']


class Args(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class OverviewArgs(Args):
    pass


class ClientsArgs(Args):
    role: Role | None
    cluster_id: int | None
    is_seed: bool | None
    min_priority: float | None = Field(ge=0, le=1)
    sort_by: Literal['priority_score', 'in_kzt', 'out_kzt', 'activity_kzt', 'betweenness']
    offset: int = Field(ge=0, le=100000)
    limit: int = Field(ge=1, le=25)


class ClientArgs(Args):
    gid: str = Field(pattern=r'^\d{1,20}$')


class NeighboursArgs(ClientArgs):
    direction: Literal['incoming', 'outgoing', 'both']
    offset: int = Field(ge=0, le=100000)
    limit: int = Field(ge=1, le=25)


class ClustersArgs(Args):
    cluster_id: int | None
    offset: int = Field(ge=0, le=100000)
    limit: int = Field(ge=1, le=20)


class ConnectionArgs(Args):
    source: str = Field(pattern=r'^\d{1,20}$')
    target: str = Field(pattern=r'^\d{1,20}$')
    directed: bool
    max_hops: int = Field(ge=1, le=6)


class TransactionsArgs(NeighboursArgs):
    date_from: str | None
    date_to: str | None


TOOLS = {
    'get_overview': (OverviewArgs, 'Сводка всего выбранного анализа: период, суммы, количества, распределение ролей и ограничения.'),
    'list_clients': (ClientsArgs, 'Найти и ранжировать клиентов во ВСЕЙ выборке по роли, группе, исходным клиентам и приоритету. null отключает фильтр. Сортировка по убыванию; глобальный rank сохраняется. Пагинация до 25 строк.'),
    'get_client': (ClientArgs, 'Получить все рассчитанные признаки, роль, объяснение и вклад факторов одного клиента. gid всегда точная строка.'),
    'get_counterparties': (NeighboursArgs, 'Контрагенты клиента и агрегированные направленные переводы. Сортировка по сумме за период, не по приоритету. Пагинация до 25 связей.'),
    'get_clusters': (ClustersArgs, 'Получить одну группу по cluster_id или список групп (null), упорядоченный по числу клиентов. Пагинация до 20 групп.'),
    'find_connection': (ConnectionArgs, 'Найти кратчайший путь в наблюдаемом графе, максимум 6 шагов. directed=true соблюдает направления; false ищет структурную связь. Путь не доказывает движение одних и тех же денег.'),
    'get_transactions': (TransactionsArgs, 'Отдельные операции клиента из исходных файлов выбранного анализа: суммы и даты, только точность до дня. date_from/date_to: YYYY-MM-DD или null. Пагинация по дате, до 25 строк; итоги вычисляются по всем отфильтрованным операциям.'),
}


def tool_definitions():
    return [dict(type='function', name=name, description=description, strict=True,
                 parameters=model.model_json_schema()) for name, (model, description) in TOOLS.items()]


@lru_cache(maxsize=4)
def transaction_rows(directory):
    return pq.read_table(directory / 'inputs' / 'transactions.parquet').to_pylist()


NODE_FIELDS = ('gid', 'rank', 'role', 'role_score', 'priority_score', 'cluster_id', 'is_seed',
               'truncated_by_depth', 'in_kzt', 'out_kzt', 'in_deg', 'out_deg', 'evidence')


class AnalysisTools:
    def __init__(self, run_id):
        self.run_id = run_id
        self.directory = snapshot(run_id)
        self.data = read_analysis(self.directory)
        self.nodes = {row['gid']: row for row in self.data['nodes']}
        self.edges = self.data['edges']
        self.report = get_run(run_id)
        self.sources = []
        self.seen_clients = set()

    def node(self, gid):
        if gid not in self.nodes:
            raise ValueError('Клиент не найден в выбранном анализе.')
        return self.nodes[gid]

    def record(self, title, result, gids=()):
        ids = list(dict.fromkeys(gid for gid in gids if gid in self.nodes))
        self.seen_clients.update(ids)
        source_id = f'S{len(self.sources) + 1}'
        # These sources and client links come from server lookups, never model-generated URLs.
        if 'summary' in result:
            summary = result['summary']
            preview = f"Клиентов: {summary['nodes_count']}; связей: {summary['edges_count']}; переводов: {summary['transactions_count']}. Период: {summary['period_start']} — {summary['period_end']}."
        elif 'evidence' in result:
            preview = result['evidence']
        elif 'found' in result:
            preview = f"Путь {'найден' if result['found'] else 'не найден'}; ограничение: {result['max_hops']} шагов; {'с учётом направления' if result['directed'] else 'структурная связь без учёта направления'}."
        else:
            total = result.get('total', result.get('total_edges', 0))
            shown = len(result.get('items', result.get('edges', [])))
            preview = f"Найдено: {total}; возвращено: {shown}; пропущено перед страницей: {result.get('offset', result.get('filters', {}).get('offset', 0))}."
            if 'total_amount_kzt' in result:
                preview += f" Сумма по всем отфильтрованным операциям: {result['total_amount_kzt']:,.2f} KZT."
        self.sources.append(dict(id=source_id, title=title, client_ids=ids[:10], preview=preview))
        return dict(source_id=source_id, run_id=self.run_id, data=result)

    def execute(self, name, raw_arguments):
        if name not in TOOLS or len(raw_arguments) > 8192:
            raise ValueError('Неизвестный инструмент или слишком длинные аргументы.')
        args = TOOLS[name][0].model_validate_json(raw_arguments)
        return getattr(self, name)(args)

    def get_overview(self, _args):
        result = dict(summary=self.report['summary'], warnings=self.report['warnings'],
                      role_counts=dict(Counter(n['role'] for n in self.nodes.values())),
                      isolated_count=sum(n['is_isolated'] for n in self.nodes.values()),
                      boundary_count=sum(n['truncated_by_depth'] for n in self.nodes.values()))
        return self.record('Сводка анализа', result)

    def list_clients(self, args):
        selected = [n for n in self.nodes.values()
                    if (args.role is None or n['role'] == args.role)
                    and (args.cluster_id is None or n['cluster_id'] == args.cluster_id)
                    and (args.is_seed is None or n['is_seed'] == args.is_seed)
                    and (args.min_priority is None or n['priority_score'] >= args.min_priority)]
        selected.sort(key=lambda n: (-round(n[args.sort_by], 12), int(n['gid'])))
        page = selected[args.offset:args.offset + args.limit]
        result = dict(total=len(selected), offset=args.offset, returned=len(page),
                      has_more=args.offset + len(page) < len(selected), filters=args.model_dump(),
                      items=[{key: n[key] for key in NODE_FIELDS} for n in page])
        return self.record('Клиенты и рейтинг', result, (n['gid'] for n in page))

    def get_client(self, args):
        return self.record(f'Карточка клиента {args.gid}', self.node(args.gid), [args.gid])

    def get_counterparties(self, args):
        self.node(args.gid)
        rows = [e for e in self.edges if (args.direction != 'outgoing' and e['dst'] == args.gid)
                or (args.direction != 'incoming' and e['src'] == args.gid)]
        rows.sort(key=lambda e: (-e['sum_kzt'], int(e['src']), int(e['dst'])))
        page = rows[args.offset:args.offset + args.limit]
        result = dict(gid=args.gid, direction=args.direction, total_edges=len(rows),
                      total_amount_kzt=round(fsum(e['sum_kzt'] for e in rows), 2),
                      total_transactions=sum(e['n_tx'] for e in rows), offset=args.offset,
                      has_more=args.offset + len(page) < len(rows), edges=page)
        return self.record(f'Переводы клиента {args.gid}', result, [args.gid, *[g for e in page for g in (e['src'], e['dst'])]])

    def get_clusters(self, args):
        rows = sorted(self.data['clusters'], key=lambda c: (-c['n_nodes'], c['cluster_id']))
        if args.cluster_id is not None:
            rows = [c for c in rows if c['cluster_id'] == args.cluster_id]
            if not rows:
                raise ValueError('Группа не найдена в этом анализе.')
        page = rows[args.offset:args.offset + args.limit]
        return self.record('Группы клиентов', dict(total=len(rows), offset=args.offset,
                           has_more=args.offset + len(page) < len(rows), items=page),
                           [g for c in page for g in c['top_gids']])

    def find_connection(self, args):
        self.node(args.source)
        self.node(args.target)
        adjacency = {gid: set() for gid in self.nodes}
        for e in self.edges:
            adjacency[e['src']].add(e['dst'])
            if not args.directed:
                adjacency[e['dst']].add(e['src'])
        queue = deque([(args.source, 0)])
        parents = {args.source: None}
        while queue:
            current, depth = queue.popleft()
            if current == args.target:
                break
            if depth >= args.max_hops:
                continue
            for other in sorted(adjacency[current], key=int):
                if other not in parents:
                    parents[other] = current
                    queue.append((other, depth + 1))
        path = []
        if args.target in parents:
            current = args.target
            while current is not None:
                path.append(current)
                current = parents[current]
            path.reverse()
        pairs = set(zip(path, path[1:]))
        edges = [e for e in self.edges if (e['src'], e['dst']) in pairs
                 or (not args.directed and (e['dst'], e['src']) in pairs)]
        result = dict(found=bool(path), directed=args.directed, max_hops=args.max_hops,
                      path=path, edges=edges, limitation='Путь показывает наблюдаемую связь, не доказывает последовательную пересылку одних и тех же денег. Отсутствие пути в этих пределах не доказывает отсутствие связи.')
        return self.record('Связь между клиентами', result, [args.source, args.target, *path])

    def get_transactions(self, args):
        self.node(args.gid)
        start = date.fromisoformat(args.date_from) if args.date_from else None
        end = date.fromisoformat(args.date_to) if args.date_to else None
        if start and end and start > end:
            raise ValueError('Начальная дата позже конечной.')
        try:
            original = transaction_rows(self.directory)
        except (FileNotFoundError, OSError):
            raise ValueError('Исходные операции этого анализа недоступны; доступны агрегированные связи.') from None
        rows = [dict(src=str(t['src']), dst=str(t['dst']), date=str(t['date']), sum_kzt=t['sum_kzt'])
                for t in original
                if ((args.direction != 'outgoing' and str(t['dst']) == args.gid)
                    or (args.direction != 'incoming' and str(t['src']) == args.gid))
                and (start is None or t['date'] >= start) and (end is None or t['date'] <= end)]
        rows.sort(key=lambda t: (t['date'], int(t['src']), int(t['dst']), t['sum_kzt']))
        page = rows[args.offset:args.offset + args.limit]
        result = dict(filters=args.model_dump(), total=len(rows), total_amount_kzt=round(fsum(t['sum_kzt'] for t in rows), 2),
                      has_more=args.offset + len(page) < len(rows), items=page,
                      date_precision='day; время внутри дня неизвестно')
        return self.record(f'Операции клиента {args.gid}', result, [args.gid, *[g for t in page for g in (t['src'], t['dst'])]])
