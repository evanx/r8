FROM node:7.5.0
ADD package.json .
RUN npm install
ADD lib lib
CMD ["node", "--harmony", "lib/index.js"]
