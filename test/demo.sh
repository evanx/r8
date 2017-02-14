(
  set -u -e -x
  mkdir -p tmp
  mkdir -p $HOME/volumes/test-r8/
  for name in test-r8-redis test-r8-app test-r8-decipher test-r8-encipher
  do
    if docker ps -a -q -f "name=/$name" | grep '\w'
    then
      docker rm -f `docker ps -a -q -f "name=/$name"`
    fi
  done
  sleep 1
  if docker network ls | grep test-r8-network
  then
    docker network rm test-r8-network
  fi
  docker network create -d bridge test-r8-network
  redisContainer=`docker run --network=test-r8-network \
      --name test-r8-redis -d redis`
  redisHost=`docker inspect $redisContainer |
      grep '"IPAddress":' | tail -1 | sed 's/.*"\([0-9\.]*\)",/\1/'`
  dd if=/dev/urandom bs=32 count=1 > $HOME/volumes/test-r8/spiped-keyfile
  decipherContainer=`docker run --network=test-r8-network \
    --name test-r8-decipher -v $HOME/volumes/test-r8/spiped-keyfile:/spiped/key:ro \
    -d spiped \
    -d -s "[0.0.0.0]:6444" -t "[$redisHost]:6379"`
  decipherHost=`docker inspect $decipherContainer |
    grep '"IPAddress":' | tail -1 | sed 's/.*"\([0-9\.]*\)",/\1/'`
  encipherContainer=`docker run --network=test-r8-network \
    --name test-r8-encipher -v $HOME/volumes/test-r8/spiped-keyfile:/spiped/key:ro \
    -d spiped \
    -e -s "[0.0.0.0]:6333" -t "[$decipherHost]:6444"`
  encipherHost=`docker inspect $encipherContainer |
    grep '"IPAddress":' | tail -1 | sed 's/.*"\([0-9\.]*\)",/\1/'`
  redis-cli -h $encipherHost -p 6333 set user:evanxsummers '{"twitter":"evanxsummers"}'
  redis-cli -h $encipherHost -p 6333 lpush r8:q user:evanxsummers
  appContainer=`docker run --name test-r8-app -d \
    --network=test-r8-network \
    -v $HOME/volumes/test-r8/data:/data \
    -e host=$encipherHost \
    -e port=6333 \
    evanxsummers/r8`
  sleep 2
  redis-cli -h $encipherHost -p 6333 llen r8:q
  docker logs $appContainer
  find $HOME/volumes/test-r8/data
  #docker rm -f test-r8-redis test-r8-app test-r8-decipher test-r8-encipher
  #docker network rm test-r8-network
)
