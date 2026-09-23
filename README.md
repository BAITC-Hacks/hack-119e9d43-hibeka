# hack-119e9d43-hibeka
Hackathon team repository for HIBEKA

## Фронтенд — этапы 1–2

Адаптивное приложение React + TypeScript: очередь с пагинацией, поиск и фильтры,
синхронизированная карточка клиента, контрагенты и копирование gid.
Данные пока из изолированного демонстрационного адаптера.
Требуется Node.js 22 (от 22.13) или 24+.

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

Открыть http://127.0.0.1:5173. Объём реализации, допущения и команды проверок —
в [frontend/README.md](frontend/README.md). Аналитический API пока не подключён.
