import logger from '../utils/logger.js';
import { query } from '../db/connection.js';

// Common DEX router addresses
const DEX_ROUTERS = [
  '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2
  '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3
  '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3 Universal
  '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F', // SushiSwap
].map(a => a.toLowerCase());

class SandwichDetector {
  constructor() {
    this.whaleThreshold = 100000; // $100k USD
  }

  async analyzeBlock(blockNumber, transactions) {
    if (!Array.isArray(transactions) || transactions.length < 3) return;

    logger.info(`Analyzing block ${blockNumber} for sandwiches (${transactions.length} txs)`);

    for (let i = 1; i < transactions.length - 1; i++) {
      const prevTx = transactions[i - 1];
      const currentTx = transactions[i];
      const nextTx = transactions[i + 1];

      // Skip if any tx is invalid
      if (!prevTx?.hash || !currentTx?.hash || !nextTx?.hash) continue;

      // Check if current tx is a whale swap
      const isWhale = this.isWhaleSwap(currentTx);
      if (!isWhale) continue;

      // Check if surrounded by same MEV bot
      const mevBot = this.detectMEVBot(prevTx, nextTx, currentTx);
      if (!mevBot) continue;

      // Calculate MEV profit
      const profit = this.calculateMEVProfit(prevTx, currentTx, nextTx);
      
      if (profit > 0) {
        await this.saveSandwichEvent(blockNumber, prevTx, currentTx, nextTx, mevBot, profit);
        logger.info(`🚨 SANDWICH DETECTED! Block ${blockNumber}, Profit: $${profit.toFixed(2)}`);
      }
    }
  }

  isWhaleSwap(tx) {
    // Check if tx is to a DEX router
    if (!tx.to || !DEX_ROUTERS.includes(tx.to.toLowerCase())) return false;

    // Estimate USD value (simplified)
    const ethValue = parseFloat(tx.value || 0) / 1e18;
    const usdValue = ethValue * 3500; // Rough ETH price
    
    return usdValue > this.whaleThreshold;
  }

  detectMEVBot(prevTx, nextTx, victimTx) {
    // Same sender for front-run and back-run
    if (!prevTx.from || !nextTx.from) return null;
    if (prevTx.from !== nextTx.from) return null;
    
    // Must be different from victim
    if (prevTx.from === victimTx.from) return null;
    
    return prevTx.from;
  }

  calculateMEVProfit(frontTx, victimTx, backTx) {
    try {
      const frontGas = parseFloat(frontTx.gasPrice || 0) * parseFloat(frontTx.gasLimit || 21000);
      const backGas = parseFloat(backTx.gasPrice || 0) * parseFloat(backTx.gasLimit || 21000);
      const totalGas = (frontGas + backGas) / 1e18;
      
      const victimValue = parseFloat(victimTx.value || 0) / 1e18;
      const estimatedProfit = victimValue * 0.005; // 0.5% slippage
      
      const netProfit = (estimatedProfit - totalGas) * 3500;
      
      return Math.max(0, netProfit);
    } catch (error) {
      return 0;
    }
  }

  async saveSandwichEvent(blockNumber, frontTx, victimTx, backTx, mevBot, profit) {
    try {
      const victimValue = parseFloat(victimTx.value || 0) / 1e18 * 3500;
      
      await query(
        `INSERT INTO whale_transactions 
         (block_number, tx_hash, victim_tx_hash, mev_bot_address, front_run_tx_hash, back_run_tx_hash, swap_amount_usd, mev_profit_usd, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (tx_hash) DO NOTHING`,
        [
          blockNumber,
          victimTx.hash,
          victimTx.hash,
          mevBot,
          frontTx.hash,
          backTx.hash,
          victimValue,
          profit
        ]
      );
    } catch (error) {
      logger.error('Error saving sandwich event:', error.message);
    }
  }
}

export default new SandwichDetector();