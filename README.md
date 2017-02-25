# refile

This service archives JSON documents from Redis to disk-based BLOB storage for publication.

<img src="https://raw.githubusercontent.com/evanx/refile/master/docs/readme/main.png"/>

## Use case

The intended use case is for publishing cacheable data to the web. Structured data is stored in Redis for simplicity and in-memory speed. However, to reduce RAM requirements, large collections of JSON documents are archived to disk-based storage. Those documents are typically retrieved via HTTP e.g. using Nginx.

## Config

See `lib/config.js`
```javascript
module.exports = {
    description: 'Utility to archive Redis JSON keys to BLOB storage.',
    required: {
        blobStore: {
            description: 'the BLOB store options e.g. directory for file storage',
            default: 'data/'
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
        snapshot: {
            description: 'the snapshot ID for recovery',
            default: 1
        },
        outq: {
            description: 'the output queue for archived keys',
            required: false
        },
        expire: {
            description: 'the expiry to set on archived keys',
            unit: 'seconds',
            example: 60,
            required: false
        },
        action: {
            description: 'the action to perform on archived keys if expire not set',
            options: ['delete'],
            required: false
        },
    }
}
```

Note that if `outq` is set, then the processed key is pushed to that queue. Further processing from that queue takes responsibility to expire or delete the archived keys.

```
if (config.outq) {
    multi.lpush(config.outq, key);
} else if (config.expire) {
    multi.expire(key, config.expire);
} else if (config.action === 'delete'){
    multi.del(key);
}
```

Otherwise if `expire` is set then once the key has been extracted to BLOB storage, it is set to expire.

Otherwise if `action` is set to `delete` then the key is deleted.



## Usage

The application sets some JSON data in Redis:
```sh
redis-cli set user:evanxsummers '{"twitter": "@evanxsummers"}'
```
The application pushes the updated key to `refile:key:q`
```sh
redis-cli lpush refile:key:q user:evanxsummers
```

This utility will read the JSON content from Redis and write it to BLOB storage.

The intention is that the documents are retrieved via HTTP sourced from that BLOB storage, rather than from Redis.

A document that has been deleted can similarly be pushed to this queue:
```sh
redis-cli del user:evanxsummers
redis-cli lpush refile:key:q user:evanxsummers
```
where in this case, refile will remove the JSON file from the BLOB store.

## Files

In the case of the key `user:evanxsummers` the following files are written to storage:
```
data/key/498/user-evanxsummers.json.gz
data/sha/858/858cc063aaa86d463676b39889fc317562b7bb1a.user-evanxsummers.json.gz
data/time/2017-02-14/01h12m20/998/user-evanxsummers.json.gz
```
where the file in `data/key/` is the current version of the document to be published via HTTP.


### Key files

Note that the path is split up with `/` so that when using a simple file system as BLOB storage,
e.g served using Nginx, there will be a limited number of files per subdirectory, for practical reasons.

In the case of `data/key/` the path is prefixed by first three hex digits of the SHA of the key itself:
```
evan@dijkstra:~$ echo -n 'user:evanxsummers' | sha1sum | cut -b1-3
498
```

Also note that any alphanumeric characters including colons are replaced with a dash, hence the file name `user-evanxsummers.json.gz` for the key `user:evanxsummers`


### Immutable historical files

Additionally two historical versions are stored:
- a copy named according to the SHA of the contents i.e. content addressable
- a copy named by the timestamp when the content is archived

These two files are intended to be immutable facts, i.e. not overwritten by subsequent updates. The SHA files are intended for versioning, and the timestamped copies are useful for debugging.

```sh
$ zcat data/time/2017-02-14/01h12m20/998/user-evanxsummers.json.gz | jq
{
  "twitter": "@evanxsummers"
}
```

Incidently, naturally the compressed content can be streamed as in by the HTTP server, assuming the client accepts `gzip` encoding.


## Snapshots

The SHA and timestamp for each archival is recorded in Redis against the current snapshot ID. That data in Redis, together with the above files, should be sufficient to create a snapshot, e.g. for recovery.

Another service will publish a specified snapshot from the BLOB store, by looking up the corresponding SHA (version) from Redis for that document and snapshot. Such a service can be useful for a rollback/forward strategy.

The following related services are planned:
- delete an older snapshot, including related SHA files
- recover a specific snapshot to BLOB storage
- redirecting web server for a specific snapshot i.e. to the appropriate SHA file
- proxying web server for a specific snapshot


## Docker

You can build as follows:
```
docker build -t refile https://github.com/evanx/refile.git
```

For a sample deployment script with the following `docker run` command, see https://github.com/evanx/refile/blob/master/bin/redeploy.sh
```
docker run --name refile -d \
  --restart unless-stopped \
  --network=host \
  -v $home/volumes/refile/data:/data \
  -e NODE_ENV=$NODE_ENV \
  -e host=localhost \
  -e expire=2 \
  refile
```
where
- the host's Redis instance is used since `--network=host`
- the host's filesystem is used relative to a specified `$home` directory
- refiled keys are expired after two seconds.


### Test

See `test/demo.sh` https://github.com/evanx/refile/blob/master/test/demo.sh
```
redis-cli -h $encipherHost -p 6333 set user:evanxsummers '{"twitter":"evanxsummers"}'
redis-cli -h $encipherHost -p 6333 lpush refile:key:q user:evanxsummers
appContainer=`docker run --name refile-app -d \
  --network=refile-network \
  -v $HOME/volumes/refile/data:/data \
  -e host=$encipherHost \
  -e port=6333 \
  evanxsummers/refile`
```

Builds:
- isolated network `refile-network`
- isolated Redis instance named `refile-redis`
- two `spiped` containers to test encrypt/decrypt tunnels
- the prebuilt image `evanxsummers/refile`
- host volume `$HOME/volumes/refile/data`

```
evan@dijkstra:~/refile$ sh test/demo.sh
...
/home/evan/volumes/refile/data/time/2017-02-17/20h28m53/919/user-evanxsummers.json.gz
/home/evan/volumes/refile/data/key/498/user-evanxsummers.json.gz
/home/evan/volumes/refile/data/sha/814/8148962a123c3b629a8b78d70052a14d71563694.user-evanxsummers.json.gz/hom...
{"twitter":"evanxsummers"}
```

## Implementation

See `lib/main.js`

We monitor the `refile:key:q` input queue.
```javascript
    const blobStore = require(config.blobStoreType)(config.blobStore);
    while (true) {
        const key = await client.brpoplpushAsync('refile:key:q', 'refile:busy:key:q', 1);    
        ...        
    }
```

We record the following in Redis:
```javascript
multi.hset(`refile:modtime:h`, key, timestamp);
multi.hset(`refile:sha:h`, key, sha);
multi.hset(`refile:${config.snapshot}:sha:h`, key, sha);
multi.zadd(`refile:${config.snapshot}:key:${key}:z`, timestamp, sha);
```            
where the `sha` of the `key` is stored for the snapshot, and also the historical SHA's for a specific key are recorded in a sorted set by the `timestamp`

If the specified Redis key does not exist, we can assume it was deleted. In this case we record the following in Redis:
```javascript
multi.hset(`refile:modtime:h`, key, timestamp);
multi.hdel(`refile:sha:h`, key);
multi.hdel(`refile:${config.snapshot}:sha:h`, key);
multi.zadd(`refile:${config.snapshot}:key:${key}:z`, timestamp, timestamp);
```
where we delete current entries for this key and add the `timetamped` to a sorted set, for point-of-time recovery.


### Appication archetype

Incidently `lib/index.js` uses the `redis-app-rpf` application archetype.
```
require('redis-app-rpf')(require('./spec'), require('./main'));
```
where we extract the `config` from `process.env` according to the `spec` and invoke our `main` function.

See https://github.com/evanx/redis-app-rpf.

This provides lifecycle boilerplate to reuse across similar applications.

<hr>
https://twitter.com/@evanxsummers
