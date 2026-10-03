set -e
git pull
docker compose --profile prod up -d --build
docker compose --profile prod ps
