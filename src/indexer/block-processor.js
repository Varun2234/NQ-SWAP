import rpcManager from '../ethereum/rpc-manager.js';
import logger from '../utils/logger.js';
import { query } from '../db/connection.js';
import sandwichDetector from '../ethereum/sandwich-detector.js';

class BlockProcessor {
  constructor() {
    this.isRunning = false;
    this.currentBlock = 0;
    this.latestBlock = 0;
  }

  async start(startBlock) {
    this.currentBlock = startBlock;
    this.isRunning = true;
    
    logger.info(`Starting block processor from block ${startBlock}`);
    
    while (this.isRunning) {
      try {
        await this.processNextBlock();
        await this.sleep(1000);
      } catch (error) {
        logger.error('Block processing error:', error);
        await this.sleep(5000);
      }
    }
  }

  async processNextBlock() {
    this.latestBlock = await rpcManager.getBlockNumber();
    const safeBlock = this.latestBlock - 12;
    
    if (this.currentBlock > safeBlock) {
      logger.info(`Caught up to chain, waiting... (current: ${this.currentBlock}, safe: ${safeBlock})`);
      return;
    }

    logger.info(`Processing block ${this.currentBlock}`);
    
    // Get block with transaction hashes
    const block = await rpcManager.getBlock(this.currentBlock);
    
    if (!block) {
      logger.warn(`Block ${this.currentBlock} not found`);
      return;
    }

    await this.saveBlock(block);
    
    // Fetch full transaction details
    const transactions = [];
    const txHashes = block.transactions || [];
    
    logger.info(`Fetching ${txHashes.length} transactions for block ${this.currentBlock}`);
    
    for (const txHash of txHashes) {
      try {
        const tx = await rpcManager.getTransaction(txHash);
        if (tx) {
          transactions.push(tx);
        }
      } catch (error) {
        logger.error(`Failed to fetch transaction ${txHash}:`, error.message);
      }
    }
    
    logger.info(`Fetched ${transactions.length} full transactions`);
    
    // Save transactions
    let savedCount = 0;
    for (const tx of transactions) {
      const success = await this.processTransaction(tx, block);
      if (success) savedCount++;
    }
    
    logger.info(`Saved ${savedCount} transactions for block ${this.currentBlock}`);

    // Analyze for sandwich attacks
    if (transactions.length >= 3) {
      await sandwichDetector.analyzeBlock(this.currentBlock, transactions);
    }

    this.currentBlock++;
  }

  async saveBlock(block) {
    try {
      await query(
        `INSERT INTO blocks (block_number, block_hash, parent_hash, timestamp, is_finalized)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (block_number) DO NOTHING`,
        [
          block.number,
          block.hash,
          block.parentHash,
          new Date(block.timestamp * 1000),
          false
        ]
      );
    } catch (error) {
      logger.error('Error saving block:', error);
    }
  }

  async processTransaction(tx, block) {
    try {
      if (!tx || !tx.hash) {
        logger.warn('Invalid transaction - missing hash');
        return false;
      }
      
      await query(
        `INSERT INTO transactions 
         (block_number, tx_hash, from_address, to_address, value, gas_price, input_data, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [
          block.number,
          tx.hash,
          tx.from || '',
          tx.to || '',
          tx.value?.toString() || '0',
          tx.gasPrice?.toString() || '0',
          tx.data || '',
          new Date(block.timestamp * 1000)
        ]
      );
      return true;
    } catch (error) {
      logger.error(`Error saving transaction ${tx.hash.slice(0, 20)}:`, error.message);
      return false;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.isRunning = false;
    logger.info('Block processor stopped');
  }
}

export default new BlockProcessor();