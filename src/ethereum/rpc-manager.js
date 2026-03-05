import { JsonRpcProvider } from 'ethers';
import logger from '../utils/logger.js';
import config from '../config/index.js';

class RPCManager {
  constructor() {
    this.endpoints = [
      config.rpcPrimary,
      config.rpcBackup,
    ].filter(Boolean);
    
    this.currentIndex = 0;
    this.providers = this.endpoints.map(url => new JsonRpcProvider(url));
    this.lastBlock = 0;
  }

  getCurrentProvider() {
    return this.providers[this.currentIndex];
  }

  async withFailover(operation) {
    for (let i = 0; i < this.endpoints.length; i++) {
      try {
        const provider = this.getCurrentProvider();
        const result = await operation(provider);
        return result;
      } catch (error) {
        logger.error(`RPC ${this.currentIndex} failed:`, error.message);
        this.switchToNext();
      }
    }
    throw new Error('All RPC endpoints failed');
  }

  switchToNext() {
    this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
    logger.info(`Switched to RPC ${this.currentIndex}`);
  }

  async getBlockNumber() {
    return this.withFailover(provider => provider.getBlockNumber());
  }

  async getBlock(blockNumber) {
    // Get block with transaction hashes
    return this.withFailover(provider => provider.getBlock(blockNumber, false));
  }

  async getTransaction(txHash) {
    // Get full transaction details
    return this.withFailover(provider => provider.getTransaction(txHash));
  }
}

export default new RPCManager();