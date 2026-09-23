import type {
  ClientSummary,
  ClientDetails,
  Cluster,
  Counterparty,
  Run,
} from '../types/api.ts';

/** Entirely synthetic examples, unrelated to the private Parquet dataset. */
export const demoRun: Run = {
  run_id: 'demo-july-2026',
  created_at: '2026-09-23T09:00:00Z',
  status: 'completed',
  stage: null,
  summary: {
    period_start: '2026-07-01',
    period_end: '2026-07-31',
    n_nodes: 63,
    n_edges: 63,
    n_transactions: 90,
    n_seed: 18,
    n_clusters: 18,
    n_isolated: 9,
    n_truncated: 9,
    sum_kzt: 7470000,
    elapsed_seconds: 0.84,
  },
  warnings: [
    'Роли и приоритеты в этом примере заданы вручную для проверки интерфейса. Исходный датасет не анализировался.',
  ],
  error: null,
};

const exampleClients: ClientSummary[] = [
  {
    gid: '900000000000000105',
    rank: 1,
    role: 'consolidator',
    role_score: 0.72,
    priority_score: 0.82,
    cluster_id: 0,
    depth: 2,
    is_seed: false,
    truncated_by_depth: false,
    in_deg: 3,
    out_deg: 1,
    in_kzt: 280000,
    out_kzt: 250000,
    evidence:
      'Получает 280 000 KZT от 3 клиентов. Признаки сбора средств; полный баланс неизвестен.',
    priority_reason_short:
      '3 отправителя; объединяет несколько направлений переводов.',
  },
  {
    gid: '900000000000000101',
    rank: 2,
    role: 'peripheral',
    role_score: 0,
    priority_score: 0.71,
    cluster_id: 0,
    depth: 0,
    is_seed: true,
    truncated_by_depth: false,
    in_deg: 0,
    out_deg: 3,
    in_kzt: 0,
    out_kzt: 300000,
    evidence:
      'Отправляет 300 000 KZT трём клиентам. Входящие исходного клиента могут быть неполными.',
    priority_reason_short:
      '300 000 KZT наблюдаемой активности; 3 исходящие связи.',
  },
  {
    gid: '900000000000000102',
    rank: 3,
    role: 'transit',
    role_score: 0.35,
    priority_score: 0.63,
    cluster_id: 0,
    depth: 1,
    is_seed: false,
    truncated_by_depth: false,
    in_deg: 1,
    out_deg: 1,
    in_kzt: 120000,
    out_kzt: 100000,
    evidence:
      'Вход 120 000 KZT, выход 100 000 KZT. Суммы сопоставимы; хронология не проверена.',
    priority_reason_short:
      'Связывает отправителя и сборщика; активность 220 000 KZT.',
  },
  {
    gid: '900000000000000103',
    rank: 4,
    role: 'transit',
    role_score: 0.62,
    priority_score: 0.58,
    cluster_id: 0,
    depth: 1,
    is_seed: false,
    truncated_by_depth: false,
    in_deg: 1,
    out_deg: 1,
    in_kzt: 80000,
    out_kzt: 80000,
    evidence:
      'Вход и выход по 80 000 KZT. Кандидат на транзит по месячным суммам.',
    priority_reason_short:
      'Две направленные связи; структурно достижим из исходного клиента.',
  },
  {
    gid: '900000000000000104',
    rank: 5,
    role: 'transit',
    role_score: 0.65,
    priority_score: 0.54,
    cluster_id: 0,
    depth: 1,
    is_seed: false,
    truncated_by_depth: false,
    in_deg: 1,
    out_deg: 1,
    in_kzt: 100000,
    out_kzt: 100000,
    evidence:
      'Вход и выход по 100 000 KZT. Кандидат на транзит; движение тех же денег не доказано.',
    priority_reason_short: '200 000 KZT наблюдаемой активности и 2 связи.',
  },
  {
    gid: '900000000000000106',
    rank: 6,
    role: 'peripheral',
    role_score: 0,
    priority_score: 0.31,
    cluster_id: 0,
    depth: 4,
    is_seed: false,
    truncated_by_depth: true,
    in_deg: 1,
    out_deg: 0,
    in_kzt: 250000,
    out_kzt: 0,
    evidence:
      'Вход 250 000 KZT; узел на границе 4-го колена. Дальнейшие переводы не наблюдаются.',
    priority_reason_short:
      'Получено 250 000 KZT; продолжение потока неизвестно.',
  },
  {
    gid: '900000000000000107',
    rank: 7,
    role: 'peripheral',
    role_score: 0,
    priority_score: 0,
    cluster_id: 1,
    depth: 0,
    is_seed: true,
    truncated_by_depth: false,
    in_deg: 0,
    out_deg: 0,
    in_kzt: 0,
    out_kzt: 0,
    evidence:
      'Входящих связей 0, исходящих 0. Роль по имеющейся выгрузке не определена.',
    priority_reason_short:
      'Связей нет; транзакционных оснований для приоритета недостаточно.',
  },
];

function shiftGid(gid: string, block: number): string {
  return (BigInt(gid) + BigInt(block) * 1000n).toString();
}

// Nine independent synthetic groups exercise three pages without loading real data.
export const demoClients: ClientSummary[] = Array.from(
  { length: 9 },
  (_, block) =>
    exampleClients.map((client) => ({
      ...client,
      gid: shiftGid(client.gid, block),
      cluster_id: client.cluster_id + block * 2,
      priority_score: Number(
        (client.priority_score * (1 - block * 0.04)).toFixed(6),
      ),
    })),
)
  .flat()
  .sort(
    (a, b) => b.priority_score - a.priority_score || a.gid.localeCompare(b.gid),
  )
  .map((client, index) => ({ ...client, rank: index + 1 }));

const exampleEdges = [
  {
    src: '900000000000000101',
    dst: '900000000000000102',
    sum_kzt: 120000,
    n_tx: 2,
  },
  {
    src: '900000000000000101',
    dst: '900000000000000103',
    sum_kzt: 80000,
    n_tx: 1,
  },
  {
    src: '900000000000000101',
    dst: '900000000000000104',
    sum_kzt: 100000,
    n_tx: 1,
  },
  {
    src: '900000000000000102',
    dst: '900000000000000105',
    sum_kzt: 100000,
    n_tx: 2,
  },
  {
    src: '900000000000000103',
    dst: '900000000000000105',
    sum_kzt: 80000,
    n_tx: 1,
  },
  {
    src: '900000000000000104',
    dst: '900000000000000105',
    sum_kzt: 100000,
    n_tx: 1,
  },
  {
    src: '900000000000000105',
    dst: '900000000000000106',
    sum_kzt: 250000,
    n_tx: 2,
  },
];

export function demoDetails(client: ClientSummary): ClientDetails {
  const block = Math.floor(client.cluster_id / 2);
  const edges = exampleEdges.map((edge) => ({
    ...edge,
    src: shiftGid(edge.src, block),
    dst: shiftGid(edge.dst, block),
  }));
  const incoming: Counterparty[] = edges
    .filter((e) => e.dst === client.gid)
    .map((e) => ({ gid: e.src, sum_kzt: e.sum_kzt, n_tx: e.n_tx }));
  const outgoing: Counterparty[] = edges
    .filter((e) => e.src === client.gid)
    .map((e) => ({ gid: e.dst, sum_kzt: e.sum_kzt, n_tx: e.n_tx }));
  const factorDefinitions = [
    { name: 'Посредничество', raw_value: 0.12, weight: 0.3 },
    { name: 'Значимость в сети', raw_value: 0.018, weight: 0.2 },
    {
      name: 'Наблюдаемая активность',
      raw_value: client.in_kzt + client.out_kzt,
      weight: 0.2,
    },
    { name: 'Связь с исходными клиентами', raw_value: 1, weight: 0.15 },
    {
      name: 'Количество связей',
      raw_value: client.in_deg + client.out_deg,
      weight: 0.15,
    },
  ];
  return {
    ...client,
    run_id: demoRun.run_id,
    metrics: {
      in_tx: incoming.reduce((sum, item) => sum + item.n_tx, 0),
      out_tx: outgoing.reduce((sum, item) => sum + item.n_tx, 0),
      pass_through: client.in_kzt > 0 ? client.out_kzt / client.in_kzt : null,
      first_in_date: incoming.length ? '2026-07-05' : null,
      days_after_first_in: incoming.length ? 26 : null,
    },
    role_selection_reason:
      client.role === 'consolidator'
        ? 'В примере выполнено условие: не менее 3 отправителей.'
        : 'Демонстрационная роль задана вручную для проверки интерфейса.',
    role_explanation: client.evidence,
    priority_explanation: `${client.priority_reason_short} Пять вкладов ниже иллюстрируют структуру ответа API; оценки синтетические.`,
    priority_factors: factorDefinitions.map((factor) => ({
      ...factor,
      normalized_value: client.priority_score,
      contribution: factor.weight * client.priority_score,
    })),
    warnings: [
      'Показаны операции внутри выборки, а не полный оборот счёта.',
      ...(client.is_seed
        ? ['У исходного клиента входящие данные могут быть неполными.']
        : []),
      ...(client.truncated_by_depth
        ? ['Граница четвёртого колена: дальнейшие переводы не наблюдаются.']
        : []),
      ...(client.in_deg + client.out_deg === 0
        ? ['Транзакционных связей в выгрузке нет.']
        : []),
    ],
    incoming,
    outgoing,
  };
}

export const demoClusters: Cluster[] = Array.from(
  { length: 18 },
  (_, cluster_id) => {
    const clients = demoClients.filter(
      (node) => node.cluster_id === cluster_id,
    );
    return {
      cluster_id,
      n_nodes: clients.length,
      n_seed: clients.filter((node) => node.is_seed).length,
      sum_kzt_internal: cluster_id % 2 === 0 ? 830000 : 0,
      top_gids: clients.slice(0, 5).map((node) => node.gid),
      hypothesis:
        cluster_id % 2 === 0
          ? 'Синтетическая группа: переводы от исходного клиента к узлу сбора средств.'
          : 'Изолированный исходный клиент; связей в примере нет.',
    };
  },
);
