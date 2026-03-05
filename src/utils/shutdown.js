import logger from './logger.js';
import blockProcessor from '../indexer/block-processor.js';

export function setupShutdownHandlers() {
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    blockProcessor.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    blockProcessor.stop();
    process.exit(0);
  });
}