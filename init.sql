-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create blocks table
CREATE TABLE IF NOT EXISTS blocks (
    block_number BIGINT PRIMARY KEY,
    block_hash VARCHAR(66) NOT NULL,
    parent_hash VARCHAR(66) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    is_finalized BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create transactions table (partitioned by day)
CREATE TABLE IF NOT EXISTS transactions (
    id UUID DEFAULT uuid_generate_v4(),
    block_number BIGINT NOT NULL,
    tx_hash VARCHAR(66) NOT NULL,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42),
    value NUMERIC(78, 0),
    gas_price NUMERIC(78, 0),
    gas_used BIGINT,
    input_data TEXT,
    decoded_data JSONB,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Create default partition
CREATE TABLE IF NOT EXISTS transactions_default PARTITION OF transactions
    DEFAULT;

-- Create whale_transactions table for detected sandwiches
CREATE TABLE IF NOT EXISTS whale_transactions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    block_number BIGINT NOT NULL,
    tx_hash VARCHAR(66) NOT NULL UNIQUE,
    victim_tx_hash VARCHAR(66) NOT NULL,
    mev_bot_address VARCHAR(42) NOT NULL,
    front_run_tx_hash VARCHAR(66) NOT NULL,
    back_run_tx_hash VARCHAR(66) NOT NULL,
    swap_amount_usd NUMERIC(20, 2) NOT NULL,
    mev_profit_usd NUMERIC(20, 2) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_blocks_number ON blocks(block_number);
CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp);
CREATE INDEX IF NOT EXISTS idx_tx_block_number ON transactions(block_number);
CREATE INDEX IF NOT EXISTS idx_tx_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_whale_timestamp ON whale_transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_whale_block ON whale_transactions(block_number);

-- Function to create daily partitions automatically
CREATE OR REPLACE FUNCTION create_daily_partition()
RETURNS void AS $$
DECLARE
    partition_date TEXT;
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    partition_date := TO_CHAR(NOW(), 'YYYY_MM_DD');
    start_date := CURRENT_DATE;
    end_date := CURRENT_DATE + INTERVAL '1 day';
    partition_name := 'transactions_' || partition_date;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = partition_name
    ) THEN
        EXECUTE format('CREATE TABLE %I PARTITION OF transactions
            FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            start_date,
            end_date
        );
    END IF;
END;
$$ LANGUAGE plpgsql;