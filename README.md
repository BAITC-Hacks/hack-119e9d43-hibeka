# hack-119e9d43-hibeka
Hackathon team repository for HIBEKA

## Текущее состояние

Минимальный сервер FastAPI с проверкой доступности `GET /api/health`.
Анализ датасетов и пользовательский интерфейс пока не реализованы.
Исходные данные находятся в `data/`, заготовка организаторов — в `starter/`.

## Установка

Команды выполняются из корня репозитория. Проверено на Python 3.14.4.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## Запуск

После активации виртуального окружения:

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Проверка в другом терминале:

```bash
curl http://127.0.0.1:8000/api/health
```

Ожидаемый ответ с HTTP 200:

```json
{"status":"ok"}
```

Документация API: <http://127.0.0.1:8000/docs>.
Для остановки сервера нажмите `Ctrl+C` в терминале, где он запущен.
