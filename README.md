# NQ-Swap Indexer - Complete Architecture & Implementation Guide

## Project Overview

A production-grade DEX indexer that detects MEV (Maximal Extractable Value) sandwich attacks on whale transactions (>$100k) across Ethereum mainnet. Built as a custom alternative to The Graph for specific high-frequency trading analysis.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [File Structure & Purpose](#file-structure--purpose)
3. [Database Schema](#database-schema)
4. [Core Components](#core-components)
5. [Setup & Installation](#setup--installation)
6. [Running the Project](#running-the-project)
7. [API Documentation](#api-documentation)
8. [Design Decisions](#design-decisions)
9. [Troubleshooting](#troubleshooting)
10. [Future Improvements](#future-improvements)

---

## System Architecture

### Root Configuration Files

| File                 | Purpose                                      | Lines |
| -------------------- | -------------------------------------------- | ----- |
| `docker-compose.yml` | Orchestrates PostgreSQL + Node.js containers | 35    |
| `Dockerfile`         | Builds Node.js container image               | 12    |
| `package.json`       | Node.js dependencies and scripts             | 25    |
| `.env`               | Environment variables (RPC keys, DB config)  | 12    |
| `init.sql`           | **REMOVED** - Tables created via code        | -     |
| `THOUGHTS.md`        | This documentation file                      | 400+  |

## Component-by-Component Breakdown

### 1. Configuration Management (src/config/index.js)

**Purpose**: Centralized environment variable management and application configuration.

**Key Responsibilities**:

- Load environment variables from .env file using dotenv
- Parse and validate configuration values
- Provide default values for optional settings
- Export configuration object for use across application

**Configuration Parameters**:

- DATABASE_URL: PostgreSQL connection string with credentials
- RPC_PRIMARY: Alchemy Ethereum mainnet endpoint
- RPC_BACKUP: Infura Ethereum mainnet endpoint (via MetaMask)
- START_BLOCK: Initial block number for indexing (default: 18500000)
- CONFIRMATIONS: Number of blocks to wait for finality (default: 12)
- WHALE_THRESHOLD_USD: Minimum USD value for whale detection (default: 100000)
- PORT: Express server port (default: 3000)
- NODE_ENV: Environment mode (development/production)

**Security Note**: Database credentials and RPC keys are never logged in full. The database URL is masked before logging to prevent credential leakage.

---

### 2. Database Connection (src/db/connection.js)

**Purpose**: PostgreSQL connection pooling and query execution.

**Key Responsibilities**:

- Create and manage connection pool with optimal settings
- Provide query function for parameterized SQL execution
- Handle connection errors gracefully
- Support concurrent database operations

**Connection Pool Settings**:

- Maximum connections: 20
- Idle timeout: 30 seconds
- Connection timeout: 2 seconds

**Why Connection Pooling**: The indexer processes hundreds of transactions per block. Connection pooling eliminates the overhead of creating new connections for each query, significantly improving throughput.

**Error Handling**: The pool emits error events for unexpected disconnections, allowing the application to log issues without crashing.

---

### 3. RPC Manager (src/ethereum/rpc-manager.js)

**Purpose**: Ethereum JSON-RPC communication with automatic failover.

**Key Responsibilities**:

- Maintain connections to multiple RPC endpoints
- Execute RPC calls with automatic failover
- Switch to backup endpoints on primary failure
- Provide methods: getBlockNumber, getBlock, getTransaction

**Failover Strategy**:

1. Attempt operation on current RPC endpoint
2. If error occurs, log failure and switch to next endpoint
3. Retry operation on new endpoint
4. If all endpoints fail, throw error to caller

**Endpoint Management**:

- Primary: Alchemy (higher rate limits, better performance)
- Backup: Infura (via MetaMask Developer, reliability)
- Rotation: Circular rotation through available endpoints

**Block Fetching Strategy**:

- getBlock retrieves block header with transaction hashes
- Individual getTransaction calls fetch full transaction details
- This two-step approach ensures complete data despite RPC limitations

**Why Not eth_getBlockByNumber with full transactions**: Some RPC providers limit the depth of data returned. Fetching individual transactions guarantees access to all fields (from, to, value, gasPrice, data).

---

### 4. Block Processor (src/indexer/block-processor.js)

**Purpose**: Core indexing engine that orchestrates block fetching, transaction processing, and sandwich detection.

**Key Responsibilities**:

- Continuous block streaming from Ethereum mainnet
- Safe block calculation (current tip minus confirmations)
- Transaction persistence to database
- Trigger sandwich detection analysis
- Graceful error recovery and retry logic

**Processing Loop**:

1. Check latest block number from network
2. Calculate safe block (latest minus 12 confirmations)
3. If current block exceeds safe block, wait and retry
4. Fetch block with transaction hashes
5. Fetch full details for each transaction
6. Save block metadata to database
7. Save all transactions to database
8. Analyze transaction sequence for sandwich patterns
9. Increment block counter and repeat

**Rate Limiting**: One-second delay between blocks to prevent RPC rate limit exhaustion and reduce infrastructure costs.

**Error Recovery**: Five-second delay after errors to prevent rapid retry loops that could overwhelm the system or trigger RPC rate limits.

**Transaction Validation**: Each transaction is validated for presence of hash and required fields before database insertion. Invalid transactions are logged and skipped rather than crashing the process.

---

### 5. Sandwich Detector (src/ethereum/sandwich-detector.js)

**Purpose**: Identify MEV sandwich attacks on whale transactions.

**Key Responsibilities**:

- Analyze transaction sequences within blocks
- Identify whale transactions (>$100k USD value)
- Detect MEV bot patterns (same address front-running and back-running)
- Calculate estimated MEV profit
- Persist detected attacks to database

**Detection Algorithm**:

1. Iterate through transactions in block order
2. For each transaction, check if recipient is known DEX router
3. Calculate approximate USD value using ETH price (~$3500)
4. If value exceeds $100k threshold, mark as potential victim
5. Check previous and next transactions from same sender
6. If surrounding transactions are from identical address (different from victim), flag as MEV bot
7. Calculate profit: estimated price impact minus gas costs
8. If profit is positive, save to whale_transactions table

**DEX Router Identification**:

- Uniswap V2 Router: 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
- Uniswap V3 Router: 0xE592427A0AEce92De3Edee1F18E0157C05861564
- Uniswap V3 Universal Router: 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
- SushiSwap Router: 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F

**Profit Calculation Methodology**:

- Front-run gas cost: gasPrice \* gasLimit
- Back-run gas cost: gasPrice \* gasLimit
- Total gas cost in ETH converted to USD
- Estimated profit: 0.5% of victim transaction value (typical slippage)
- Net profit: Estimated profit minus gas costs

**Limitations and Future Improvements**:

- Current implementation uses approximate ETH price. Production system should integrate Chainlink or Uniswap TWAP price feeds.
- Profit calculation is simplified. Real MEV profit requires simulating execution or analyzing actual token transfers in logs.
- Does not detect complex MEV strategies like JIT liquidity or multi-block attacks.

---

### 6. Logger Utility (src/utils/logger.js)

**Purpose**: Structured logging with multiple output destinations.

**Key Responsibilities**:

- Log messages with timestamps and severity levels
- Output to console for real-time monitoring
- Write errors to dedicated error log file
- Write all logs to combined log file

**Log Levels**:

- error: System errors requiring investigation
- warn: Warning conditions
- info: General operational information
- debug: Detailed debugging (not enabled in production)

**Log Files**:

- logs/error.log: Error-level messages only
- logs/combined.log: All log levels

**Why Winston**: Winston provides structured JSON logging, multiple transports, and log rotation capabilities essential for production observability.

---

### 7. Shutdown Handler (src/utils/shutdown.js)

**Purpose**: Graceful application shutdown on termination signals.

**Key Responsibilities**:

- Listen for SIGTERM (Docker stop, Kubernetes)
- Listen for SIGINT (Ctrl+C)
- Stop block processor cleanly
- Exit process with success code

**Why Graceful Shutdown**: Prevents data corruption by ensuring in-flight database operations complete before process termination. Critical for database consistency during deployments or container restarts.

---

### 8. Main Application Entry (src/index.js)

**Purpose**: Application bootstrap and coordination.

**Key Responsibilities**:

- Initialize Express server
- Mount API routes
- Start block processor
- Handle startup errors

**Server Startup Sequence**:

1. Load configuration
2. Initialize logger
3. Start Express server on configured port
4. Log successful startup
5. Start block processor with configured start block
6. Handle block processor errors without crashing server

**API Endpoints**:

- GET /health: Liveness probe, returns status and timestamp
- GET /whales?date=YYYY-MM-DD: Query detected sandwich attacks by date

**Error Handling**: Block processor failures are logged but do not crash the server. The server remains available for API requests even if indexing pauses.

---

## Data Flow Walkthrough

### Block Ingestion Flow

Block Processor requests latest block number from RPC Manager
│
▼
RPC Manager queries Alchemy (or Infura on failover)
│
▼
Block Processor calculates safe block (latest - 12 confirmations)
│
▼
If current block <= safe block, proceed; else wait
│
▼
Block Processor requests block data (hashes only)
│
▼
RPC Manager returns block header with transaction hashes
│
▼
Block Processor iterates through transaction hashes
│
▼
For each hash, RPC Manager fetches full transaction details
│
▼
Block metadata saved to 'blocks' table
│
▼
Each transaction saved to 'transactions' table
│
▼
Full transaction array passed to Sandwich Detector
│
▼
Sandwich Detector analyzes for MEV patterns
│
▼
If sandwich detected, saved to 'whale_transactions' table
│
▼
Block number incremented, loop repeats

### API Request Flow

Client sends GET /whales?date=2023-11-04
│
▼
Express server receives request
│
▼
Route handler validates date parameter
│
▼
Database query executed via connection pool
│
▼
Results formatted as JSON response
│
▼
Response returned to client with count and transactions array

---

## Infrastructure and Deployment

### Docker Architecture

The application uses Docker Compose for local development and single-node deployment. The architecture consists of two services:

**PostgreSQL Service**:

- Base image: postgres:15-alpine (minimal, secure)
- Port exposed: 5432 for external access
- Healthcheck: pg_isready command ensures database is accepting connections before dependent services start
- Volume: Named volume postgres_data persists data across container restarts

**Indexer Service**:

- Base image: node:20-alpine (current LTS, minimal)
- Build process: Multi-stage build with native dependencies (python3, make, g++)
- Port exposed: 3000 for API access
- Volume mounts:
  - ./src for live code reloading during development
  - ./logs for log file persistence
- Environment: Loaded from .env file
- Command: npm run dev (uses nodemon for auto-restart on changes)

**Docker Network**:

- Internal DNS resolution allows services to communicate by container name
- PostgreSQL accessible at postgres:5432 from indexer
- No external exposure of database port required for security

### Environment Configuration

Environment variables are loaded from .env file (not committed to version control):
DATABASE_URL=postgresql://indexer:indexer_secret@postgres:5432/nqswap_indexer
RPC_PRIMARY=https://eth-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
RPC_BACKUP=https://mainnet.infura.io/v3/YOUR_INFURA_KEY
START_BLOCK=18500000
CONFIRMATIONS=12
WHALE_THRESHOLD_USD=100000
PORT=3000
NODE_ENV=development

**Security**: Sensitive values (RPC keys, database credentials) are never hardcoded. The database URL in logs is masked to show only the protocol and host.

---

## Setup and Operation Instructions

### Prerequisites

- Docker Desktop installed and running
- Git for version control
- Text editor or IDE
- Free accounts on Alchemy and MetaMask Developer (for Infura)

### Initial Setup

1. Start Docker Desktop
   - Verify Docker Desktop is running by checking system tray for whale icon
   - Wait for "Engine running" status

2. Clone or create project directory

3. Create environment file
   - Copy .env.example to .env
   - Add your Alchemy API key (get from alchemy.com)
   - Add your Infura API key (get from developer.metamask.io)

### 4. Build and Start Services

**Initial Build and Start**:

- Open PowerShell or terminal
- Navigate to project directory: cd D:\Projects\nq-swap-indexer
- Build and start containers: docker compose up --build -d
- Wait for build completion (5-10 minutes on first run)
- Verify containers running: docker ps

**Expected Output**:

- Container nqswap_postgres shows status Healthy
- Container nqswap_indexer shows status Up
- Both containers display in docker ps output

---

### 5. Verify Startup

**Check Indexer Logs**:

- Command: docker logs nqswap_indexer --tail 50
- Look for: Server running on port 3000
- Look for: Starting block processor from block X
- Look for: Processing block X with Y transactions

**Check Database**:

- Command: docker exec -it nqswap_postgres psql -U indexer -d nqswap_indexer -c "SELECT COUNT(\*) FROM blocks;"
- Should return increasing count as blocks process

---

### 6. Test API Endpoints

**Health Check**:

- Command: curl http://localhost:3000/health
- Alternative PowerShell command: Invoke-WebRequest -Uri http://localhost:3000/health -UseBasicParsing | Select-Object -Expand Content
- Expected Response: {"status":"ok","timestamp":"2026-03-06T..."}

**Whales API**:

- Command: curl http://localhost:3000/whales?date=2023-11-04
- Alternative PowerShell command: Invoke-WebRequest -Uri http://localhost:3000/whales?date=2023-11-04 -UseBasicParsing | Select-Object -Expand Content
- Expected Response: {"date":"2023-11-04","count":0,"transactions":[]}
- Note: Count will be zero until MEV sandwiches are detected

---

## Daily Operations Commands

**View Real-Time Logs**:

- Command: docker logs -f nqswap_indexer
- Press Ctrl+C to exit log stream

**View Recent Logs**:

- Command: docker logs nqswap_indexer --tail 100
- Shows last 100 log lines

**Check Transaction Count**:

- Command: docker exec -it nqswap_postgres psql -U indexer -d nqswap_indexer -c "SELECT COUNT(\*) FROM transactions;"

**Check Whale Detections**:

- Command: docker exec -it nqswap_postgres psql -U indexer -d nqswap_indexer -c "SELECT \* FROM whale_transactions LIMIT 5;"

**Check Recent Blocks**:

- Command: docker exec -it nqswap_postgres psql -U indexer -d nqswap_indexer -c "SELECT block_number, timestamp FROM blocks ORDER BY block_number DESC LIMIT 5;"

---

## Container Management Commands

**Stop Services Gracefully**:

- Command: docker compose down
- Preserves database data in volume

**Stop and Remove Data**:

- Command: docker compose down -v
- Warning: This deletes all indexed data permanently

**Restart After Code Changes**:

- Command: docker compose up --build -d
- Rebuilds images with new code and restarts containers

**Check Container Status**:

- Command: docker ps
- Shows running containers, ports, and health status

**Restart Single Container**:

- Command: docker restart nqswap_indexer
- Useful for refreshing without full rebuild

---

## Troubleshooting Commands

**Docker Desktop Not Running**:

- Error: error during connect: open //./pipe/dockerDesktopLinuxEngine
- Solution: Start Docker Desktop application from Start Menu
- Wait for green Engine running status at bottom left
- Retry: docker compose up -d

**Check PostgreSQL Health**:

- Command: docker ps
- Look for: nqswap_postgres status should show Healthy
- If not healthy: docker logs nqswap_postgres

**Database Connection Issues**:

- Check connection: docker exec -it nqswap_postgres pg_isready -U indexer
- Should return: postgres:5432 - accepting connections

**RPC Connection Test**:

- Command: curl http://localhost:3000/test-rpc
- Should return: {"blockNumber":2459XXXX,"rpc":"connected"}
- If fails: Check RPC keys in .env file are valid

**Port Already in Use**:

- Find process: netstat -ano | findstr :3000
- Kill process: taskkill /PID XXXX /F
- Or change PORT in .env file to different number

---

## Windows-Specific PowerShell Commands

**For curl Alternative in PowerShell**:

- Use: Invoke-WebRequest -Uri http://localhost:3000/health -UseBasicParsing
- Add: | Select-Object -Expand Content to see just the response body
- Add: -Method GET for explicit GET requests

**Suppress Security Warning**:

- Add -UseBasicParsing flag to all Invoke-WebRequest calls
- Or type A when prompted for Yes to All

**Check File Contents**:

- Command: Get-Content docker-compose.yml
- Shows file content in terminal

**Create Directory Structure**:

- Command: mkdir src\config, src\db, src\ethereum, src\indexer, src\api, src\utils

**Remove Files or Directories**:

- Command: Remove-Item -Recurse -Force src\db\migrations
- Removes entire directory and contents

### Daily Operations

**Viewing logs**:

- Real-time: docker logs -f nqswap_indexer
- Recent: docker logs nqswap_indexer --tail 100

**Checking database**:

- Transaction count: docker exec -it nqswap_postgres psql -U indexer -d nqswap_indexer -c "SELECT COUNT(\*) FROM transactions;"
- Whale detections: docker exec -it nqswap_postgres psql -U indexer -d nqswap_indexer -c "SELECT \* FROM whale_transactions LIMIT 5;"

**Stopping services**:

- Graceful: docker compose down
- With data removal: docker compose down -v (removes database volume)

**Restarting after code changes**:

- docker compose up --build -d

### Troubleshooting

**Docker Desktop not running**:

- Error: "error during connect: open //./pipe/dockerDesktopLinuxEngine"
- Solution: Start Docker Desktop application, wait for green status

**RPC rate limits**:

- Symptom: "All RPC endpoints failed" errors
- Solution: Check Alchemy/Infura dashboards for quota usage; upgrade plan or add delays

**Database connection refused**:

- Symptom: "connect ECONNREFUSED postgres:5432"
- Solution: Check postgres container health: docker ps; ensure postgres shows (healthy)

**Port already in use**:

- Symptom: "bind: address already in use :::3000"
- Solution: Kill process using port 3000 or change PORT in .env

---

## Design Decisions and Trade-offs

### Why PostgreSQL over specialized time-series databases?

PostgreSQL was chosen for:

- Familiarity and team expertise
- JSON support for flexible transaction data
- Partitioning capabilities for time-series data
- ACID compliance for financial data integrity
- Rich ecosystem and tooling

Trade-off: Less optimized than InfluxDB or TimescaleDB for pure time-series workloads, but sufficient for this use case.

### Why fetch individual transactions instead of full blocks?

Some Ethereum RPC providers limit the depth of data in eth_getBlockByNumber responses. Fetching individual transactions via eth_getTransactionByHash guarantees access to all transaction fields including input data and gas prices.

Trade-off: Significantly more RPC calls (N+1 per block where N is transaction count). Mitigated by one-second delays between blocks to respect rate limits.

### Why 12-block confirmation threshold?

Ethereum's recommended finality is 12 blocks under normal network conditions. This provides probabilistic finality suitable for this use case.

Trade-off: 12-block delay means recent transactions are not immediately indexed. For real-time applications, this could be reduced with additional reorg handling logic.

### Why simplified profit calculation?

Full MEV profit calculation requires:

- Simulating transaction execution
- Tracking token transfers in logs
- Integrating price oracles for accurate USD conversion

The simplified approach uses 0.5% estimated slippage minus gas costs, which catches obvious sandwiches but misses complex strategies.

Trade-off: Faster implementation and lower RPC usage, but higher false negative rate. Production system should implement log parsing and simulation.

---

## Security Considerations

**RPC Key Protection**:

- Keys stored in environment variables, never in code
- Keys masked in logs
- Separate keys for primary and backup to isolate quota exhaustion

**Database Security**:

- Credentials isolated in Docker internal network
- No external exposure of PostgreSQL port in production
- Connection pooling prevents connection exhaustion attacks

**API Security**:

- No administrative endpoints exposed
- Input validation on date parameters
- No sensitive data in error messages

**Container Security**:

- Alpine Linux base images (minimal attack surface)
- Non-root user execution where possible
- No unnecessary packages installed

---

## Future Enhancements

**Immediate Priorities**:

1. Implement actual log parsing for accurate swap detection
2. Integrate Chainlink price feeds for accurate USD valuation
3. Add reorganization detection and rollback logic
4. Implement transaction receipt fetching for gas used

**Medium Term**:

1. Add WebSocket support for real-time updates
2. Implement caching layer for frequently accessed data
3. Add metrics and monitoring (Prometheus/Grafana)
4. Create admin dashboard for system monitoring

**Long Term**:

1. Multi-chain support (Polygon, Arbitrum, Base)
2. Machine learning for MEV pattern detection
3. Flashbots integration for MEV auction data
4. Historical backfill capability

---

## Performance Characteristics

**Throughput**: Approximately 1 block per second (limited by RPC rate limits and one-second delay)

**Database**: Can handle millions of transactions with daily partitioning

**Memory**: Constant memory usage regardless of blockchain size due to streaming processing

**Scalability**: Horizontal scaling possible by partitioning block ranges across multiple indexer instances

---

## Conclusion

The NQ-Swap Indexer demonstrates a production-ready blockchain data pipeline with emphasis on reliability, observability, and maintainability. The modular architecture allows individual components to be upgraded or replaced without system-wide changes. The use of standard technologies (Node.js, PostgreSQL, Docker) ensures operational familiarity and reduces deployment risk.
