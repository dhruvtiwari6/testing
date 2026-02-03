const {io} = require('socket.io-client');
const mediasoupClient = require("mediasoup-client");


const socket = io('/mediasoup');

console.log("hello ji");
socket.on('connection-success', (data) => {

  console.log('Server confirmed:', data.socket);
});

let device  ;
let params = {
    //media soup params
}

const streamSuccess = async ( stream ) => {
    localVideo.srcObject = stream
    const track = stream.getVideoTracks()[0]
    params = {
        track,
        ...params
    }
}

const getLocalStream = () => {
    navigator.getUserMedia({
        audio: false,
        video: {
            width: {
                min : 640,
                max: 1920,
            },

            height : {
                min : 400,
                max : 1080
            }
        }
    }, streamSuccess, error => {
        console.log(error.message)
    })
}

const createDevice = async () => {
    try {
        device = new mediasoupClient.Device()
        await device.load({
            routerRtpCapabilities: rtpCapabilities
        })

        console.log('rtp  capabilityi : ...')

    }catch (e) {
        console.log(e);
        if(e.name === 'UnsupportedError'){
            console.warn('browser not supported')
        }
    }
}

const getRtpCapabilities = () => {
    socket.emit('getRtpCapabilities' ,(rtpCapabilities)=> {
        console.log(`router capabilities : ${rtpCapabilities}` )
    })
}

btnLocalVideo.addEventListener('click', getLocalStream);
btnRtpCapabilities.addEventListener('click' , getRtpCapabilities);