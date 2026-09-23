import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import type { AnalysisGraph } from '../api/client';
import type { Role } from '../types/api';
import { roleLabels } from '../utils/roles';
import { formatMoney } from '../utils/format';
import { directionLayout } from '../utils/graphLayout';
import { selectGraphView } from '../utils/graphView';
import type { GraphDirection } from '../utils/graphView';

const colors: Record<Role, string> = {
  consolidator: '#c69846',
  transit: '#5689bb',
  distributor: '#9781bb',
  terminal: '#6b9a7d',
  coordinator: '#437d78',
  peripheral: '#a3adb5',
};
const clusterColors = [
  '#5689bb',
  '#c69846',
  '#9781bb',
  '#6b9a7d',
  '#ba7d74',
  '#437d78',
  '#919656',
  '#7886b5',
];

export function LocalGraph({
  graph,
  onSelect,
}: {
  graph: AnalysisGraph;
  onSelect: (gid: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<Core | null>(null);
  const fitGraph = useRef<() => void>(() => {});
  const selectRef = useRef(onSelect);
  const [mode, setMode] = useState<'role' | 'cluster'>('role');
  const [hover, setHover] = useState('');
  const [direction, setDirection] = useState<GraphDirection>('all');
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [edgeId, setEdgeId] = useState('');
  const [zoomState, setZoomState] = useState({
    percent: 100,
    canIncrease: true,
    canDecrease: true,
  });
  const fittedZoom = useRef(1);
  const pinnedRef = useRef('');
  const dialog = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const headingId = useId();
  const view = useMemo(
    () => selectGraphView(graph, direction, showAll),
    [graph, direction, showAll],
  );
  const visibleGraph = view.graph;
  const selectedEdge = visibleGraph.edges.find((edge) => edge.id === edgeId);
  useEffect(() => {
    if (expanded) {
      wasExpanded.current = true;
      const overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      dialog.current?.showModal();
      return () => {
        document.body.style.overflow = overflow;
      };
    }
    if (wasExpanded.current) {
      expandButton.current?.focus();
      wasExpanded.current = false;
    }
  }, [expanded]);
  useEffect(() => {
    pinnedRef.current = edgeId;
  }, [edgeId]);
  function clearSelection() {
    setEdgeId('');
    setHover('');
  }

  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    if (!container.current) return;
    // Keep bidirectional clients in the same lane when filtering arrows.
    const layout = directionLayout({ ...graph, nodes: visibleGraph.nodes });
    const cy = cytoscape({
      container: container.current,
      elements: [
        ...visibleGraph.nodes.map((node) => ({
          data: {
            ...node,
            color:
              mode === 'role'
                ? colors[node.role]
                : clusterColors[node.cluster_id % clusterColors.length],
            size: layout.sizes[node.id],
            label:
              node.id === graph.gid
                ? `Выбранный клиент\n…${node.id.slice(-6)}`
                : view.shownCount <= 20
                  ? `…${node.id.slice(-6)}`
                  : '',
          },
          position: layout.positions[node.id],
          classes: [
            node.id === graph.gid ? 'center' : '',
            node.is_seed ? 'seed' : '',
            node.truncated_by_depth ? 'boundary' : '',
          ].join(' '),
        })),
        ...visibleGraph.edges.map((edge) => ({
          data: {
            ...edge,
            width: 1.4 + Math.log10(1 + edge.sum_kzt / 5000),
            color:
              edge.source === graph.gid
                ? '#4d8179'
                : edge.target === graph.gid
                  ? '#678bad'
                  : '#bdc9d2',
          },
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            width: 'data(size)',
            height: 'data(size)',
            label: 'data(label)',
            'font-size': 15,
            color: '#334c4a',
            'text-valign': 'bottom',
            'text-margin-y': 9,
            'text-wrap': 'wrap',
            'border-width': 2,
            'border-color': '#ffffff',
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'node.seed',
          style: { 'border-width': 2.5, 'border-color': '#344f50' },
        },
        {
          selector: 'node.boundary',
          style: { shape: 'diamond' },
        },
        {
          selector: 'node.center',
          style: {
            width: 44,
            height: 44,
            'border-width': 4,
            'border-color': '#174d48',
            'background-color': '#ffffff',
            'font-size': 17,
            'font-weight': 'bold',
            'z-index': 10,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 'data(width)',
            'line-color': 'data(color)',
            'target-arrow-color': 'data(color)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 1.35,
            opacity: 0.8,
          },
        },
        { selector: '.dim', style: { opacity: 0.13 } },
        {
          selector: 'edge.lit',
          style: {
            opacity: 1,
            'line-color': '#477e77',
            'target-arrow-color': '#477e77',
          },
        },
        {
          selector: 'node.lit',
          style: {
            label: 'data(id)',
            'font-size': 17,
            'text-background-color': '#ffffff',
            'text-background-opacity': 0.95,
            'text-background-padding': '3px',
          },
        },
      ],
      layout: {
        name: 'preset',
        padding: 38,
        animate: false,
      },
      minZoom: 0.15,
      maxZoom: 3,
      wheelSensitivity: 0.2,
    });
    instance.current = cy;
    function syncZoom() {
      setZoomState({
        percent: Math.round((cy.zoom() / fittedZoom.current) * 100),
        canIncrease: cy.zoom() < cy.maxZoom() - 0.0001,
        canDecrease: cy.zoom() > cy.minZoom() + 0.0001,
      });
    }
    cy.on('zoom', syncZoom);
    fitGraph.current = () => {
      const width = layout.bounds.x2 - layout.bounds.x1;
      const height = layout.bounds.y2 - layout.bounds.y1;
      const availableHeight = Math.max(1, cy.height() - 68);
      const zoom = Math.max(
        cy.minZoom(),
        Math.min(
          cy.maxZoom(),
          (cy.width() - 32) / width,
          (availableHeight - 32) / height,
        ),
      );
      fittedZoom.current = zoom;
      cy.viewport({
        zoom,
        pan: {
          x: (cy.width() - width * zoom) / 2,
          y: (availableHeight - height * zoom) / 2,
        },
      });
      syncZoom();
    };
    fitGraph.current();
    function restoreHighlight() {
      cy.elements().removeClass('dim lit');
      const pinned = cy.getElementById(pinnedRef.current);
      if (pinned.isEdge()) {
        cy.elements().addClass('dim');
        pinned.removeClass('dim').addClass('lit');
        pinned.connectedNodes().removeClass('dim');
      }
    }
    restoreHighlight();
    cy.on('tap', 'node', (event) => selectRef.current(event.target.id()));
    cy.on('tap', 'edge', (event) => {
      pinnedRef.current = event.target.id();
      setEdgeId(event.target.id());
      restoreHighlight();
    });
    cy.on('tap', (event) => {
      if (event.target === cy) {
        pinnedRef.current = '';
        setEdgeId('');
        restoreHighlight();
      }
    });
    cy.on('mouseover', 'node', (event) => {
      const node = event.target;
      cy.elements().removeClass('dim lit').addClass('dim');
      node.closedNeighborhood().removeClass('dim');
      node.addClass('lit');
      node.connectedEdges().addClass('lit');
      setHover(
        `${node.id()} · ${roleLabels[node.data('role') as Role]} · Группа ${node.data('cluster_id')}`,
      );
    });
    cy.on('mouseover', 'edge', (event) => {
      const edge = event.target;
      cy.elements().removeClass('dim lit').addClass('dim');
      edge.removeClass('dim').addClass('lit');
      edge.connectedNodes().removeClass('dim');
      setHover(
        `${edge.data('source')} → ${edge.data('target')} · ${formatMoney(edge.data('sum_kzt') as number)} · переводов: ${edge.data('n_tx')}`,
      );
    });
    cy.on('mouseout', 'node, edge', () => {
      restoreHighlight();
      setHover('');
    });
    const observer = new ResizeObserver(() => {
      cy.resize();
      fitGraph.current();
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.current = null;
      fitGraph.current = () => {};
      cy.destroy();
    };
  }, [graph, visibleGraph, mode, expanded, view.shownCount]);
  useEffect(() => {
    const cy = instance.current;
    if (!cy) return;
    cy.elements().removeClass('dim lit');
    const edge = cy.getElementById(edgeId);
    if (edge.isEdge()) {
      cy.elements().addClass('dim');
      edge.removeClass('dim').addClass('lit');
      edge.connectedNodes().removeClass('dim');
    }
  }, [edgeId, visibleGraph, mode, expanded]);
  const content = (
    <section className="graph-section" aria-label="Связи выбранного клиента">
      <div className="section-heading">
        <div>
          <h3 id={headingId}>Связи клиента</h3>
          <p>
            {expanded
              ? graph.gid
              : 'Прямые контрагенты · суммы за период анализа'}
          </p>
        </div>
        <button
          ref={expandButton}
          className="button graph-expand"
          onClick={() => {
            setHover('');
            setExpanded((value) => !value);
          }}
          aria-label={expanded ? 'Свернуть граф' : 'Развернуть граф'}
        >
          <span aria-hidden="true">{expanded ? '↙' : '↗'}</span>
          {expanded ? 'Свернуть' : 'Развернуть'}
        </button>
      </div>
      <div className="graph-toolbar">
        <div
          className="direction-tabs"
          role="group"
          aria-label="Направление переводов"
        >
          {(
            [
              ['all', 'Все связи'],
              ['incoming', 'Входящие'],
              ['outgoing', 'Исходящие'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={direction === value}
              onClick={() => {
                clearSelection();
                setDirection(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="graph-mode">
          <span className="sr-only">Расцветка графа</span>
          <select
            value={mode}
            onChange={(event) => {
              setHover('');
              setMode(event.target.value as 'role' | 'cluster');
            }}
          >
            <option value="role">По ролям</option>
            <option value="cluster">По группам</option>
          </select>
        </label>
      </div>
      <div className="graph-scope" aria-live="polite">
        <span>
          Показано <strong>{view.shownCount}</strong> из{' '}
          <strong>{view.eligibleCount}</strong>{' '}
          {graph.truncated ? 'доступных контрагентов' : 'контрагентов'}
          {direction !== 'all' &&
            (direction === 'incoming'
              ? ' с входящими переводами'
              : ' с исходящими переводами')}
        </span>
        {view.eligibleCount > 20 && (
          <button
            className="text-button"
            onClick={() => {
              clearSelection();
              setShowAll((value) => !value);
            }}
          >
            {showAll
              ? 'Показать первые 20'
              : graph.truncated
                ? `Показать доступных (${view.eligibleCount})`
                : `Показать всех (${view.eligibleCount})`}
          </button>
        )}
      </div>
      <p className="graph-scope-note">
        {view.shownCount < view.eligibleCount
          ? 'Первые 20 по приоритету проверки. '
          : ''}
        Выбранный клиент показан отдельно. Расчёты учитывают всю выборку.
      </p>
      <div
        className="graph-direction-guide"
        aria-label="Расположение участников"
      >
        <span>↘ Отправители</span>
        <span>Выбранный клиент</span>
        <span>Получатели ↗</span>
      </div>
      <div className="graph-canvas-wrap">
        <div className="graph-viewport">
          <div
            className="graph-canvas"
            ref={container}
            role="img"
            aria-label={`Граф: выбранный клиент и ${view.shownCount} контрагентов, связей: ${visibleGraph.edges.length}. Каждую связь можно выбрать в списке под графом.`}
          />
          <span className="graph-count">
            Связей: {visibleGraph.edges.length}
          </span>
          {visibleGraph.edges.length === 0 && (
            <div className="graph-empty-note">
              {direction === 'all'
                ? 'В этой выборке нет связей с другими клиентами'
                : direction === 'incoming'
                  ? 'Входящие переводы не наблюдаются'
                  : 'Исходящие переводы не наблюдаются'}
            </div>
          )}
          <div className="graph-tools" aria-label="Масштаб графа">
            <button
              title="Приблизить"
              aria-label="Приблизить"
              disabled={!zoomState.canIncrease}
              onClick={() => {
                const cy = instance.current;
                if (cy)
                  cy.zoom({
                    level: Math.min(cy.maxZoom(), cy.zoom() * 1.25),
                    renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
                  });
              }}
            >
              +
            </button>
            <button
              title="Отдалить"
              aria-label="Отдалить"
              disabled={!zoomState.canDecrease}
              onClick={() => {
                const cy = instance.current;
                if (cy)
                  cy.zoom({
                    level: Math.max(cy.minZoom(), cy.zoom() / 1.25),
                    renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
                  });
              }}
            >
              −
            </button>
            <output
              className="graph-zoom-value"
              aria-label="Масштаб относительно вписанного графа"
              title="100% — граф вписан в область просмотра"
            >
              {zoomState.percent}%
            </output>
            <button
              className="graph-fit-button"
              title="Показать весь выбранный граф — масштаб 100%"
              aria-label="Вписать граф"
              onClick={() => fitGraph.current()}
            >
              <span aria-hidden="true">⤢</span>
              <span>Вписать граф</span>
            </button>
          </div>
        </div>
        <aside className="graph-legend" aria-label="Обозначения на графе">
          <strong className="graph-legend-heading">Обозначения</strong>
          {mode === 'role' ? (
            Object.entries(colors).map(([role, color]) => (
              <span key={role}>
                <i style={{ background: color }} />
                {roleLabels[role as Role]}
              </span>
            ))
          ) : (
            <span>
              Цвет различает группы; номер группы виден при наведении. Цвета
              могут повторяться.
            </span>
          )}
          <span>
            <i className="legend-seed" />
            Исходный клиент
          </span>
          <span>
            <i className="legend-boundary" />
            Граница выборки
          </span>
        </aside>
      </div>
      <p className="graph-navigation-hint">
        Колёсико — масштаб · перетаскивание фона — перемещение
      </p>
      {graph.truncated && (
        <p className="notice">
          В граф загружены {graph.shown_nodes - 1} из {graph.total_nodes - 1}{' '}
          контрагентов по приоритету. Фильтры применяются к загруженным связям.
          Полный список — в карточке клиента.
        </p>
      )}
      <p className="graph-hint" aria-live="polite">
        {hover ||
          'Нажмите на стрелку, чтобы увидеть суммы, или на узел, чтобы открыть клиента. Двусторонние контрагенты расположены снизу.'}
      </p>
      {visibleGraph.edges.length > 0 && (
        <label className="graph-edge-picker">
          <span>Посмотреть связь</span>
          <select
            aria-label="Выбрать связь для просмотра"
            value={selectedEdge?.id ?? ''}
            onChange={(event) => {
              setHover('');
              setEdgeId(event.target.value);
            }}
          >
            <option value="">
              Выберите стрелку на графе или связь в списке
            </option>
            {visibleGraph.edges.map((edge) => (
              <option key={edge.id} value={edge.id}>
                {edge.source} → {edge.target} · {formatMoney(edge.sum_kzt)}
              </option>
            ))}
          </select>
        </label>
      )}
      {selectedEdge && (
        <section className="connection-card" aria-label="Выбранная связь">
          <div className="connection-heading">
            <strong>Переводы за период</strong>
            <button
              className="text-button"
              aria-label="Закрыть сведения о связи"
              onClick={() => setEdgeId('')}
            >
              ×
            </button>
          </div>
          <div className="connection-parties">
            <div>
              <span>Отправитель</span>
              <button
                className="text-button mono"
                onClick={() => onSelect(selectedEdge.source)}
              >
                {selectedEdge.source}
              </button>
            </div>
            <span className="connection-arrow" aria-hidden="true">
              →
            </span>
            <div>
              <span>Получатель</span>
              <button
                className="text-button mono"
                onClick={() => onSelect(selectedEdge.target)}
              >
                {selectedEdge.target}
              </button>
            </div>
          </div>
          <div className="connection-amount">
            <strong>{formatMoney(selectedEdge.sum_kzt)}</strong>
            <span>
              Переводов: <b>{selectedEdge.n_tx}</b>
            </span>
          </div>
          <p>
            Сумма всех наблюдаемых переводов в этом направлении за период
            анализа.
          </p>
        </section>
      )}
    </section>
  );
  return expanded
    ? createPortal(
        <dialog
          ref={dialog}
          className="expanded-graph"
          aria-labelledby={headingId}
          onCancel={() => setExpanded(false)}
          onClose={() => setExpanded(false)}
        >
          {content}
        </dialog>,
        document.body,
      )
    : content;
}
