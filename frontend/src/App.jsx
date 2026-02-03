

import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

export default function App() {
  const socketRef = useRef(null);
  const rtpCapabilitiesRef = useRef(null);
  const deviceRef = useRef(null);
  const localSendTransportRef = useRef(null);
  const localRecvTransportRef = useRef(null);
  const availableProducersRef = useRef(new Set());
  const consumersRef = useRef(new Map());
  const isProducingRef = useRef(false);

  const localVideoRef = useRef(null);
  const [remoteVideos, setRemoteVideos] = useState(new Map());
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const socket = io('http://localhost:3000');
    socketRef.current = socket;

    socket.on('existing-producers', ({ producerIds }) => {
      console.log('Existing producers:', producerIds);
      producerIds.forEach(id => availableProducersRef.current.add(id));
    });

    socket.on('new-producer', ({ producerId }) => {
      console.log('New producer available:', producerId);
      availableProducersRef.current.add(producerId);
      
      if (localRecvTransportRef.current) {
        consumeProducer(producerId);
      }
    });

    socket.on('producer-closed', ({ producerId }) => {
      console.log('Producer closed:', producerId);
      availableProducersRef.current.delete(producerId);
      setRemoteVideos(prev => {
        const newMap = new Map(prev);
        newMap.delete(producerId);
        return newMap;
      });
    });

    // Auto-initialize
    initializeMedia();

    return () => socket.disconnect();
  }, []);

  const initializeMedia = async () => {
    try {
      // Get RTP capabilities
      socketRef.current.emit('routerCapability', async (cb) => {
        console.log('rtpCapabilities:', cb.rtpCapabilities);
        rtpCapabilitiesRef.current = cb.rtpCapabilities;

        // Load device
        const device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilitiesRef.current });
        deviceRef.current = device;
        console.log('Device loaded');

        // Setup both producer and consumer
        await setupProducer();
        await setupConsumer();

        setIsInitialized(true);
      });
    } catch (error) {
      console.error('Error initializing media:', error);
    }
  };

  const setupProducer = async () => {
    try {
      // Request camera permission and create producer
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      
      socketRef.current.emit('create-transport', { sender: true }, async (cb) => {
        const senderTransport = deviceRef.current.createSendTransport(cb);
        localSendTransportRef.current = senderTransport;

        senderTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          socketRef.current.emit(
            'transport-connect',
            { dtlsParameters, transportId: senderTransport.id },
            () => callback()
          );
        });

        senderTransport.on(
          'produce',
          ({ kind, rtpParameters, appData }, callback, errback) => {
            socketRef.current.emit(
              'transport-produce',
              { kind, rtpParameters, appData, transportId: senderTransport.id },
              ({ id }) => {
                console.log('Produced with ID:', id);
                callback({ id });
              }
            );
          }
        );

        // Show local video
        localVideoRef.current.srcObject = stream;

        // Start producing
        await senderTransport.produce({
          track: stream.getVideoTracks()[0],
          encodings: [
            { maxBitrate: 100000 },
            { maxBitrate: 300000 },
            { maxBitrate: 900000 },
          ],
          codecOptions: { videoGoogleStartBitrate: 1000 }
        });

        isProducingRef.current = true;
        console.log('✅ Producer ready');
      });
    } catch (error) {
      console.error('Error setting up producer (camera might be denied):', error);
    }
  };

  const setupConsumer = async () => {
    socketRef.current.emit('create-transport', { sender: false }, (cb) => {
      const recvTransport = deviceRef.current.createRecvTransport(cb);
      localRecvTransportRef.current = recvTransport;

      recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        socketRef.current.emit(
          'transport-recv-connect',
          { dtlsParameters, transportId: recvTransport.id },
          () => callback()
        );
      });

      console.log('✅ Consumer ready');

      // Consume all available producers
      availableProducersRef.current.forEach(producerId => {
        consumeProducer(producerId);
      });
    });
  };

  const consumeProducer = async (producerId) => {
    if (!localRecvTransportRef.current || !deviceRef.current) {
      console.error('Not ready to consume');
      return;
    }

    try {
      socketRef.current.emit(
        'consume',
        {
          rtpCapabilities: deviceRef.current.rtpCapabilities,
          producerId,
          transportId: localRecvTransportRef.current.id
        },
        async (cb) => {
          const consumer = await localRecvTransportRef.current.consume(cb);
          consumersRef.current.set(consumer.id, consumer);

          const { track } = consumer;
          const remoteStream = new MediaStream([track]);

          setRemoteVideos(prev => new Map(prev).set(producerId, remoteStream));

          socketRef.current.emit('consumer-resume', { consumerId: consumer.id });
          console.log('✅ Consuming producer:', producerId);
        }
      );
    } catch (error) {
      console.error('Error consuming producer:', error);
    }
  };

  return (
    <>
      <div style={{ padding: '20px' }}>
        <h2>WebRTC Multi-User Video Chat</h2>
        <p>Status: {isInitialized ? '✅ Connected' : '⏳ Connecting...'}</p>

        <div style={{ marginTop: '20px' }}>
          <h3>My Video</h3>
          <video 
            ref={localVideoRef} 
            autoPlay 
            muted 
            playsInline 
            style={{ width: '400px', border: '2px solid #333', borderRadius: '8px' }}
          />
        </div>

        <div style={{ marginTop: '20px' }}>
          <h3>Remote Videos ({remoteVideos.size})</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px' }}>
            {Array.from(remoteVideos.entries()).map(([producerId, stream]) => (
              <div key={producerId} style={{ textAlign: 'center' }}>
                <p style={{ margin: '5px 0', fontSize: '12px' }}>
                  User: {producerId.slice(0, 8)}...
                </p>
                <video
                  ref={el => {
                    if (el) el.srcObject = stream;
                  }}
                  autoPlay
                  playsInline
                  style={{ width: '300px', border: '2px solid #666', borderRadius: '8px' }}
                />
              </div>
            ))}
            {remoteVideos.size === 0 && (
              <p style={{ color: '#666' }}>No remote users yet. Open this page in another browser!</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}