#!/bin/bash
# Startet den OKR Event-Tracker in OrbStack/Docker und öffnet den Browser.
cd "$(dirname "$0")" || exit 1
echo "▶ Baue und starte okr-tracker …"
docker compose up -d --build && echo "✓ läuft auf http://localhost:8090" && open "http://localhost:8090"
echo
echo "Logs:   docker compose logs -f"
echo "Stopp:  docker compose down"
