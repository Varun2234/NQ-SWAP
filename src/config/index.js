import dotenv from 'dotenv';
dotenv.config();

export default {
  databaseUrl: process.env.DATABASE_URL,
  rpcPrimary: process.env.RPC_PRIMARY,
  rpcBackup: process.env.RPC_BACKUP,
  startBlock: parseInt(process.env.START_BLOCK) || 18500000,
  confirmations: parseInt(process.env.CONFIRMATIONS) || 12,
  whaleThreshold: parseInt(process.env.WHALE_THRESHOLD_USD) || 100000,
  port: parseInt(process.env.PORT) || 3000,
};