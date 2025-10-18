#!/bin/bash

# Database Migration Runner
# Usage: ./run_migration.sh <migration_file>
# Example: ./run_migration.sh 001_add_track_number.sql

if [ -z "$1" ]; then
    echo "Usage: ./run_migration.sh <migration_file>"
    echo "Example: ./run_migration.sh 001_add_track_number.sql"
    exit 1
fi

MIGRATION_FILE="$1"

if [ ! -f "$MIGRATION_FILE" ]; then
    echo "Error: Migration file '$MIGRATION_FILE' not found"
    exit 1
fi

# Load environment variables from .env file
if [ -f "../../.env" ]; then
    source ../../.env
else
    echo "Error: .env file not found in project root"
    exit 1
fi

echo "Running migration: $MIGRATION_FILE"
echo "Database: $POSTGRES_DB"
echo "---"

# Run migration using docker exec
docker exec -i db psql -U "$DB_USER" -d "$POSTGRES_DB" < "$MIGRATION_FILE"

if [ $? -eq 0 ]; then
    echo "---"
    echo "Migration completed successfully!"
else
    echo "---"
    echo "Migration failed!"
    exit 1
fi
