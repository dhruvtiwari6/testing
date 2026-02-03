



import { Server } from 'socket.io';
import http from 'http';
import express from 'express';
import * as mediasoup from 'mediasoup';

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: 'http://localhost:5173' }
});

const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000}
];

let worker;
let router;

// Store data per peer
const peers = new Map(); // socketId -> { transports: Map, producers: Map, consumers: Map }
const producers = new Map(); // producerId -> { socketId, producer }

(async () => {
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({ mediaCodecs });

  io.on('connection', socket => {
    console.log('New user connected:', socket.id);
    
    // Initialize peer data
    peers.set(socket.id, {
      transports: new Map(),
      producers: new Map(),
      consumers: new Map()
    });

    socket.emit('existing-producers', {
      producerIds: Array.from(producers.keys())
    });

    socket.on('routerCapability', cb => {
      cb({ rtpCapabilities: router.rtpCapabilities });
    });

    socket.on('create-transport', async ({ sender }, cb) => {
      try {
        const transport = await router.createWebRtcTransport({
          listenIps: [{ ip: '0.0.0.0', announcedIp: '127.0.0.1' }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });

        // Store transport for this peer
        peers.get(socket.id).transports.set(transport.id, transport);

        cb({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
      } catch (error) {
        console.error('Error creating transport:', error);
      }
    });

    socket.on('transport-connect', async ({ dtlsParameters, transportId }, cb) => {
      try {
        const transport = peers.get(socket.id).transports.get(transportId);
        if (!transport) {
          console.error('Transport not found:', transportId);
          return;
        }
        await transport.connect({ dtlsParameters });
        cb();
      } catch (error) {
        console.error('Error connecting transport:', error);
      }
    });

    socket.on('transport-produce', async ({ kind, rtpParameters, transportId }, cb) => {
      try {
        const transport = peers.get(socket.id).transports.get(transportId);
        if (!transport) {
          console.error('Transport not found:', transportId);
          return;
        }

        const producer = await transport.produce({ kind, rtpParameters });
        
        producers.set(producer.id, { socketId: socket.id, producer });
        peers.get(socket.id).producers.set(producer.id, producer);
        
        console.log('Producer created:', producer.id, 'by', socket.id);
        
        // Notify all OTHER clients about new producer
        socket.broadcast.emit('new-producer', { producerId: producer.id });
        
        cb({ id: producer.id });
      } catch (error) {
        console.error('Error producing:', error);
      }
    });

    socket.on('transport-recv-connect', async ({ dtlsParameters, transportId }, cb) => {
      try {
        const transport = peers.get(socket.id).transports.get(transportId);
        if (!transport) {
          console.error('Transport not found:', transportId);
          return;
        }
        await transport.connect({ dtlsParameters });
        cb();
      } catch (error) {
        console.error('Error connecting recv transport:', error);
      }
    });

    socket.on('consume', async ({ rtpCapabilities, producerId, transportId }, cb) => {
      try {
        const producerData = producers.get(producerId);
        if (!producerData) {
          console.error('Producer not found:', producerId);
          return;
        }

        if (!router.canConsume({ producerId, rtpCapabilities })) {
          console.error('Cannot consume');
          return;
        }

        const transport = peers.get(socket.id).transports.get(transportId);
        if (!transport) {
          console.error('Transport not found:', transportId);
          return;
        }

        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: true,
        });

        peers.get(socket.id).consumers.set(consumer.id, consumer);

        console.log('Consumer created:', consumer.id, 'for producer:', producerId);

        cb({
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (error) {
        console.error('Error consuming:', error);
      }
    });

    socket.on('consumer-resume', async ({ consumerId }) => {
      try {
        const consumer = peers.get(socket.id).consumers.get(consumerId);
        if (!consumer) {
          console.error('Consumer not found:', consumerId);
          return;
        }
        await consumer.resume();
        console.log('Consumer resumed:', consumerId);
      } catch (error) {
        console.error('Error resuming consumer:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      
      const peer = peers.get(socket.id);
      if (peer) {
        // Close all transports
        peer.transports.forEach(t => t.close());
        
        peer.producers.forEach((producer, id) => {
          producers.delete(id);
          socket.broadcast.emit('producer-closed', { producerId: id });
        });
        
        peers.delete(socket.id);
      }
    });
  });

  httpServer.listen(3000, () => {
    console.log('Server running on port 3000');
  });
})();