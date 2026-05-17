#!/bin/sh
set -e

echo "Waiting for database to be ready..."

echo "Running database migrations..."
npx prisma migrate deploy

echo "Running database seed..."
npx prisma db seed

echo "Starting application..."
exec node dist/src/main.js