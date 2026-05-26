#!/usr/bin/env bash

set -euo pipefail

echo "=== Starting Clean Sample Pipeline ==="

echo "Step 1/7: Cleaning old data and directories..."
rm -rf data/raw/products data/state data/normalized data/output
mkdir -p data/raw/products data/state data/normalized data/output data/output/sql

echo "Step 2/7: Collecting product links (collect:links)..."
npm run collect:links

echo "Step 3/7: Collecting product details (collect:details:sample)..."
npm run collect:details:sample

echo "Step 4/7: Normalizing raw data to CSV (normalize)..."
npm run normalize

echo "Step 5/7: Validating data quality (validate:data)..."
npm run validate:data

echo "Step 6/7: Generating SQL Seed scripts (generate:sql)..."
npm run generate:sql

echo "=== Clean Sample Pipeline Finished Successfully ==="
