import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  connectTimeout: 1000,
  lazyConnect: true,
  retryStrategy: () => null,
});

redis.on('error', () => console.log('📡 Redis Offline Mode'));

export default redis;
