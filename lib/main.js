
const assert = require('assert');
const crypto = require('crypto');
const zlib = require('zlib');
const lodash = require('lodash');
const Promise = require('bluebird');
const multiExecAsync = require('multi-exec-async');
const pathFormat = require('./pathFormat');

function removeAsync(store, key) {
    return new Promise((resolve, reject) => {
        store.remove({key},
            (err, result) => err ? reject(err) : resolve(result)
        );
    });
}

function writeAsync(store, key, data) {
    return new Promise((resolve, reject) => {
        const stream = store.createWriteStream({key},
            (err, result) => err ? reject(err) : resolve(result)
        );
        stream.write(data);
        stream.end();
    });
}

function gzipAsync(data) {
    return new Promise((resolve, reject) => {
        zlib.gzip(data,
            (err, result) => err ? reject(err) : resolve(result)
        );
    });
}

module.exports = async context => {
    const {config, logger, client} = context;
    Object.assign(global, context);
    const blobStore = require(config.blobStoreType)(config.blobStore);
    while (true) {
        const [key] = await multiExecAsync(client, multi => {
            multi.brpoplpush('r8:q', 'r8:busy:q', 1);
        });
        if (!key) {
            if (config.exit === 'empty') {
                break;
            }
            continue;
        }
        if (key === 'none') {
            break;
        }
        try {
            const timestamp = Date.now();
            const keyPath = pathFormat.keyPath(key);
            const content = await client.getAsync(key);
            if (!content) {
                await removeAsync(blobStore, keyPath);
                logger.debug({keyPath});
                await multiExecAsync(client, multi => {
                    multi.hdel(`r8:sha:h`, key);
                    multi.sadd(`r8:rem:s`, key);
                    multi.hdel(`r8:${config.snapshotId}:sha:h`, key);
                    multi.sadd(`r8:${config.snapshotId}:rem:s`, key);
                    multi.zadd(`r8:${config.snapshotId}:key:${key}:z`, timestamp, timestamp);
                    multi.lrem('r8:busy:q', 1, key);
                    if (config.outq) {
                        multi.lpush(config.outq, key);
                    }
                });
            } else {
                const timestampPath = pathFormat.timestampPath(key, new Date(timestamp));
                const sha = crypto.createHash('sha1').update(content).digest('base64')
                .replace(/\//g, '_').replace(/=+$/g, '');
                const shaPath = pathFormat.shaPath(key, sha);
                logger.debug({keyPath, shaPath, timestampPath, sha, timestamp}, JSON.parse(content));
                const gzipped = await gzipAsync(content);
                await writeAsync(blobStore, keyPath, gzipped);
                await writeAsync(blobStore, timestampPath, gzipped);
                await writeAsync(blobStore, shaPath, gzipped);
                await multiExecAsync(client, multi => {
                    multi.hset(`r8:sha:h`, key, sha);
                    multi.srem(`r8:rem:s`, key);
                    multi.hset(`r8:${config.snapshotId}:sha:h`, key, sha);
                    multi.zadd(`r8:${config.snapshotId}:key:${key}:z`, timestamp, sha);
                    multi.srem(`r8:${config.snapshotId}:rem:s`, key);
                    multi.zadd(`r8:${config.snapshotId}:key:${key}:z`, timestamp, sha);
                    multi.lrem('r8:busy:q', 1, key);
                    if (config.outq) {
                        multi.lpush(config.outq, key);
                    } else if (config.expire) {
                        multi.expire(key, config.expire);
                    } else {
                        multi.del(key);
                    }
                });
            }
        } catch (err) {
            if (err.name === 'DataError') {
                console.error(err.message, err.data);
            } else {
                console.error(err);
            }
        } finally {
        }
    }
    logger.info('exit');
};
