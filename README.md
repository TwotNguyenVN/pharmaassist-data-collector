# 💊 PharmaAssist Data Collector

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-blue.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/playwright-%5E1.49.0-green.svg)](https://playwright.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-%5E5.7.0-blue.svg)](https://www.typescriptlang.org/)
[![License: Private](https://img.shields.io/badge/License-Private-red.svg)](#)

A toolset to collect, process, and normalize reference pharmaceutical product data from **Long Chau Pharmacy**. The processed data is structured into relational formats (CSV) and ready to generate SQL scripts to populate seed data for the **PharmaAssist** project.

---

## 📌 Table of Contents
1. [Introduction](#1-introduction)
2. [Installation](#2-installation)
3. [Environment Configuration (.env)](#3-environment-configuration-env)
4. [Usage Guide](#4-usage-guide)
   - [Testing Pipeline (Sample Mode)](#testing-pipeline-sample-mode)
   - [Full Scrape Pipeline (Full Mode)](#full-scrape-pipeline-full-mode)
   - [Scraping Clean from Scratch](#scraping-clean-from-scratch)
5. [Directory Structure & Data Flow](#5-directory-structure--data-flow)
6. [Safety & Security Rules](#6-safety--security-rules)
7. [Troubleshooting](#7-troubleshooting)
8. [Medical Disclaimer](#8-medical-disclaimer)

---

## 1. Introduction

This tool is designed to automatically extract categories, products, prices, images, and active ingredients from Long Chau Pharmacy's website.

### 🚀 Key Features
* **High-Speed Scrape via Internal API:** Migrated from traditional DOM scrolling to direct calls on Long Chau's internal pagination API, boosting link scanning performance significantly.
* **Smart Checkpoint & Resume:** Tracks scraping state in real-time down to individual pages. If interrupted or blocked, configure `RESUME=true` to resume exactly where you stopped without starting over.
* **Relational Database Normalization:** Automatically parses raw JSON data into **15 relational database tables** (saved as CSV files), such as products, prices, variants, images, active ingredients, etc.
* **Automatic SQL Seed Generation:** Directly converts validated CSV files into Postgres-compatible SQL `INSERT` statements for Supabase/PostgreSQL.

---

## 2. Installation

To set up the project environment, navigate to the project directory and run the following commands:

1. **Navigate to the directory:**
   ```bash
   cd tools/data-collector
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Install Chromium browser for Playwright:**
   ```bash
   npm run install:browser
   ```

---

## 3. Environment Configuration (.env)

Copy the template file to create your own configuration file:
```bash
cp .env.example .env
```

Open `.env` and adjust the variables to fit your needs:

| Configuration Variable | Default Value | Explanation |
| :--- | :--- | :--- |
| **`CRAWL_MODE`** | `sample` | Scraping mode: `sample` (limited test run) or `full` (complete dataset run). |
| **`MAX_PRODUCTS`** | `8000` | Maximum limit of products to scrape (only applies to `sample` mode). |
| **`REQUEST_DELAY_RANDOM_MIN_MS`** | `2000` | Minimum random delay (ms) between requests to avoid rate limits. |
| **`REQUEST_DELAY_RANDOM_MAX_MS`** | `5000` | Maximum random delay (ms) between requests. |
| **`BATCH_SIZE`** | `50` | Number of products written to the raw JSON file per detailed scrape batch. |
| **`HEADLESS`** | `false` | `true` to run browser in the background, `false` to show Chromium UI window. |
| **`RESUME`** | `true` | Resume scraping from checkpoints (`true`) or delete state and restart (`false`). |
| **`RETRY_FAILED_LIMIT`** | `3` | Maximum retry attempts for failed URLs during detail scraping. |

---

## 4. Usage Guide

### Testing Pipeline (Sample Mode)
A quick run with a small set of products to verify selectors and data schema. You can run steps manually:
1. Scrape product links: `npm run collect:links`
2. Scrape sample details: `npm run collect:details:sample`
3. Normalize raw JSON to CSV: `npm run normalize`
4. Validate CSV integrity: `npm run validate:data`
5. Generate SQL script: `npm run generate:sql`

*Or run the entire sample pipeline in one command (auto-cleans old data):*
```bash
npm run pipeline:sample:clean
```

> [!TIP]
> **Running the clean command on Windows:**
> By default, the clean script runs Linux shell commands. You can configure NPM to use Git Bash as its default shell on Windows by running:
> ```bash
> npm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"
> ```
> Afterward, you can execute `npm run pipeline:sample:clean` directly from Command Prompt or PowerShell.

---

### Full Scrape Pipeline (Full Mode)
Use this workflow to collect the entire dataset from Long Chau Pharmacy (Works on both Windows and macOS):

1. **Scrape product links:**
   ```bash
   npm run collect:links
   ```
   *Uses the fast pagination API to scan thousands of product links in a few minutes.*

2. **Scrape details for all links:**
   ```bash
   npm run collect:details:full
   ```
   *Visits each product page to extract name, active ingredients, specs, images, prices, instructions, etc.*

3. **Retry failed crawls (optional):**
   ```bash
   npm run retry:failed
   ```

4. **Normalize raw JSONs to CSV:**
   ```bash
   npm run normalize
   ```

5. **Validate CSV output quality:**
   ```bash
   npm run validate:data
   ```

6. **Generate SQL seed scripts:**
   ```bash
   npm run generate:sql
   ```

---

### Scraping Clean from Scratch
To ignore all existing checkpoints, clear cache folders, and start scraping again from the very first page:

#### 1. Clear old data folders
* **💻 On Windows:**
  * **Using PowerShell:**
    ```powershell
    Remove-Item -Recurse -Force data/raw/products, data/state, data/normalized, data/output -ErrorAction Ignore
    Remove-Item -Force data/raw/product_links.raw.json -ErrorAction Ignore
    New-Item -ItemType Directory -Force data/raw/products, data/state, data/normalized, data/output, data/output/sql
    ```
  * **Using Command Prompt (cmd):**
    ```cmd
    rmdir /s /q data\raw\products
    rmdir /s /q data\state
    rmdir /s /q data\normalized
    rmdir /s /q data\output
    del data\raw\product_links.raw.json
    mkdir data\raw\products
    mkdir data\state
    mkdir data\normalized
    mkdir data\output
    mkdir data\output\sql
    ```

* **💻 On macOS (MacBook):**
  Run this command in Terminal:
  ```bash
  rm -rf data/raw/products data/state data/normalized data/output data/raw/product_links.raw.json
  mkdir -p data/raw/products data/state data/normalized data/output data/output/sql
  ```

#### 2. Update configuration in `.env`
Ensure these values are set in `.env`:
```env
RESUME=false
CRAWL_MODE=full
```

#### 3. Run the pipeline
Begin the Full Mode pipeline starting with `npm run collect:links`.

---

## 5. Directory Structure & Data Flow

To help you understand how data moves from initial configurations to SQL scripts, here is a detailed description of key files and folders:

### 5.1. Configurations & Inputs
* **`category_urls.json`**:
  * Input configuration containing Long Chau's main seed categories. You can toggle (`"enabled": true` or `"enabled": false`) categories to filter the crawl scope.
* **`.env.example`**:
  * Template file containing all configurable environment variables. You must copy it to `.env` to run the tool.

### 5.2. Generated Data Directories
Data moves sequentially through the following directories during execution:
1. **`data/raw/`**:
   * **Purpose:** Stores raw JSON data crawled directly from the website.
   * **Contents:** Discovered categories (`categories.raw.json`), scanned product links (`product_links.raw.json`), and individual product details split into batches under `data/raw/products/`.
2. **`data/state/`**:
   * **Purpose:** Stores temporary checkpoint files to manage scraping flow and enable resuming.
   * **Contents:** Link pagination offsets (`links_checkpoint.json`), list of successfully crawled product URLs (`completed_urls.json`), failed crawls (`failed_urls.json`), and duplicates (`duplicate_urls.json`).
3. **`data/normalized/`**:
   * **Purpose:** Stores cleaned data converted into RDBMS-compatible CSV tables.
   * **Contents:** 15 CSV files representing 15 database tables (e.g. `products.csv`, `product_prices.csv`, `active_ingredients.csv`, etc.).
4. **`data/output/sql/`**:
   * **Purpose:** Stores SQL insert files split into small chunks (e.g. 250 records per file) from CSVs.
   * **Significance:** Splitting the SQL files helps import data into Supabase via SQL Editor without triggering query timeouts.

### 5.3. Logs and Debugging
* **`logs/`**:
   * **Purpose:** Contains trace logs of execution (`collect.log`) and error logs (`errors.log`) for troubleshooting failed page requests or selector changes.

---

## 6. Safety & Security Rules

* **Do not spam requests:** Keep random delays (`REQUEST_DELAY_RANDOM_MIN_MS` & `REQUEST_DELAY_RANDOM_MAX_MS`) set to at least 2-3 seconds.
* **No personal data:** The tool only extracts public product data, never user reviews, comments, or customer info.
* **Do not commit raw/temp data:** The `data/` folder (except config) is excluded by `.gitignore` to avoid uploading large datasets and states.
* **Do not download images:** The crawler only saves image URLs pointing to Long Chau's CDN to save bandwidth and repository space.

---

## 7. Troubleshooting

* **Missing Playwright browser:**
  * *Symptoms:* Errors stating Chromium browser is missing when starting.
  * *Solution:* Execute `npm run install:browser`.
* **Blocked by Cloudflare WAF:**
  * *Symptoms:* HTTP 403 Forbidden or soft block verification pages.
  * *Solution:* Reset your IP address (e.g., toggle Airplane Mode on your 4G hotspot device) and set `HEADLESS=false` in `.env` to solve Captchas manually if required.
* **Foreign Key Violation error on SQL Import:**
  * *Solution:* Ensure you import the master data file (`001_master_data.sql`) before importing any product batch files (`002_products_batch_001.sql`).

---

## 8. Medical Disclaimer

> ⚠️ **EDUCATIONAL PURPOSES ONLY:** The dataset gathered via this tool is solely for development testing and demo purposes of the PharmaAssist school project. Details on medication use, dosage, indications, and warnings MUST NOT be used for real-life medical consultation.
