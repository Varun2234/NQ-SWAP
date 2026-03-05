import express from 'express';
import config from './config/index.js';
import logger from './utils/logger.js';
import blockProcessor from './indexer/block-processor.js';
import { query } from './db/connection.js';
import { setupShutdownHandlers } from './utils/shutdown.js';

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get whale transactions by date
app.get('/whales', async (req, res) => {
  try {
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: 'Date parameter required (YYYY-MM-DD)' });
    }

    const result = await query(
      `SELECT * FROM whale_transactions 
       WHERE DATE(timestamp) = $1 
       ORDER BY mev_profit_usd DESC`,
      [date]
    );

    res.json({
      date,
      count: result.rows.length,
      transactions: result.rows
    });
  } catch (error) {
    logger.error('Error fetching whales:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(config.port, async () => {
  logger.info(`Server running on port ${config.port}`);
  logger.info(`Database: ${config.databaseUrl.replace(/\/\/.*@/, '//***@')}`);
  logger.info(`Starting block processor from block ${config.startBlock}`);
  
  try {
    // Start block processor
    await blockProcessor.start(config.startBlock);
  } catch (error) {
    logger.error('Failed to start block processor:', error);
  }
});

setupShutdownHandlers();