.PHONY: help install dev migrate revision test compose-up compose-down

help:
	@echo "install       Create venv and install requirements"
	@echo "dev           Run FastAPI with reload (port __BACKEND_PORT__)"
	@echo "migrate       Apply DB migrations (alembic upgrade head)"
	@echo "revision      Autogenerate a migration (m='message')"
	@echo "test          Run unittest suite"
	@echo "compose-up    Start API and UI containers"
	@echo "compose-down  Stop local stack"

install:
	python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt

dev:
	uvicorn api.main:app --reload --host 0.0.0.0 --port __BACKEND_PORT__

migrate:
	alembic upgrade head

revision:
	alembic revision --autogenerate -m "$(m)"

test:
	python -m unittest discover -s tests -q

compose-up:
	docker compose up -d --build

compose-down:
	docker compose down
