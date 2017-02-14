module.exports = {
    description: 'Utility to archive Redis JSON keys to BLOB storage.',
    required: {
        blobStore: {
            description: 'the BLOB store options e.g. directory for file storage',
            default: 'r8data/'
        },
        blobStoreType: {
            description: 'the BLOB store type',
            default: 'fs-blob-store'
        },
        host: {
            description: 'the Redis host',
            default: 'localhost'
        },
        port: {
            description: 'the Redis port',
            default: 6379
        },
        snapshotId: {
            description: 'the snapshot ID for recovery',
            default: 1
        },
        outq: {
            description: 'the output queue for processed keys',
            required: false
        },
        expire: {
            description: 'the expiry to set on archived keys',
            unit: 'seconds',
            example: 60,
            required: false
        },
        mode: {
            description: 'the mode of operation',
            default: 'snapshot',
            example: 'minimal',
            hint: 'Minimal mode does not save snapshot'
        },
        namespace: {
            description: 'the Redis namespace for this service',
            default: 'r8'
        },
        loggerLevel: {
            description: 'the logging level',
            default: 'info',
            example: 'debug'
        }

    },
    development: {
        loggerLevel: 'debug',
        exit: 'empty',
    },
    test: {
        loggerLevel: 'debug'
    }
}
