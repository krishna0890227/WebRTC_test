
var dataChannelLog = document.getElementById('data-channel'),
    iceConnectionLog = document.getElementById('ice-connection-state'),
    iceGatheringLog = document.getElementById('ice-gathering-state'),
    signalingLog = document.getElementById('signaling-state');

var pc = null;
//data channel
var dc = null, dcInterval= null;

function start() {
 document.getElementById('start').style.display='none';
 console.log('----test----')


 // Call to the Peer Connection.
 pc = createPeerConnection()

 var time_start = null;

 const current_stamp = () => {
 if (time_start ==null) {
 time_start = new Date().getTime();
 return 0;
 } else {
 return new Date().getTime() - time_start;
 }
 };

 if (document.getElementById('use-datachannel').checked) {
  var parameters = JSON.parse(document.getElementById('datachannel-parameters').value)
  console.log('---Data Channel Parameters are: -----')
  console.log(parameters)

  dc = pc.createDataChannel('chat', parameters);

  dc.addEventListener('close',() => {
  clearInterval(dcInterval);
  dataChannelLog.textContent += '- close\n';
  });
  console.log('--------Data Channel Log is created.---------')
  dc.addEventListener('open', () => {
  dataChannelLog.textContent += '- open\n';
  dcInterval = setInterval(() => {
  var message = "ping" + current_stamp();
  dataChannelLog.textContent += '>' + message + '\n';
  dc.send(message);
  console.log('The sending interval message is ', message);
  }, 1000)
  });
  console.log('--------data are transmitted on 1000ms interval.---------')
  dc.addEventListener('message', (evt) => {
  dataChannelLog.textContent  += '<' + evt.data + '\n';
   if (evt.data.substring(0, 4) === 'pong') {
      var elapsed_ms = current_stamp()- parseInt(evt.data.substring(5), 10);
      console.log('The elapsed_ms is ' , elapsed_ms);
      dataChannelLog.textContent  += 'RTT' + elapsed_ms + 'ms\n'
   }
  });
console.log('--------Elapsed time is Calculated when transmitting the dataset.---------')
 }
 const constraints = {
        audio: false,
        video: false
    };


    if (document.getElementById('use-video').checked) {
        const videoConstraints = {};

        const device = document.getElementById('video-input').value;
        if (device) {
            videoConstraints.deviceId = { exact: device };
        }

        const resolution = document.getElementById('video-resolution').value;
        if (resolution) {
            const dimensions = resolution.split('x');
            videoConstraints.width = parseInt(dimensions[0], 0);
            videoConstraints.height = parseInt(dimensions[1], 0);
        }

        constraints.video = Object.keys(videoConstraints).length ? videoConstraints : true;
    }

    // Acquire media and start negociation.

    if (constraints.audio || constraints.video) {
        if (constraints.video) {
            document.getElementById('media').style.display = 'block';
        }
        navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
            stream.getTracks().forEach((track) => {
                pc.addTrack(track, stream);
                console.log(track);
                console.log(stream);
            });
            return negotiate();
        }, (err) => {
            console.log(" Media is acquired....")
            alert('Could not acquire media: ' + err);
        });
    } else {
       console.log("Let's start a Negotiation without video and audio....")
       // negotiate();
    }

    document.getElementById('stop').style.display = 'inline-block';
 }

// Starting a peer Connection and Video track receiving....
function createPeerConnection() {

var config= { sdpSemantics: 'undefined-plan'};



if (document.getElementById("use-stun").checked) {
config.iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
}
pc = new RTCPeerConnection(config)

pc.addEventListener('icegatheringstatechange', () => {
iceGatheringLog.textContent += '->' + pc.iceGatheringState;
 }, false);
 iceGatheringLog.textConent = pc.iceGatheringState;

pc.addEventListener('iceconnectionstatechange', () => {
  iceConnectionLog.textContent   += '->' + pc.iceConnectionState;
}, false);
iceConnectionLog.textContent  = pc.iceConnectionState;

pc.addEventListener('singallingstatechange', () => {
   signalingLog.textContent  += '->' + pc.signalingState;
}, false);

signalingLog = pc.signalingState;

pc.addEventListener('track', (evt) => {
    if (evt.track.kind == 'video')
    document.getElementById('video').srcObject = evt.streams[0];
    else
       document.getElementById('audio').srcObject = evt.stream[0];
    });
   console.log('---PC sucessfully received the audio and video Files....')
    return pc
}



function stop() {
    document.getElementById('stop').style.display = 'none';

    // close data channel
    if (dc) {
        dc.close();
    }

    // close transceivers
    if (pc.getTransceivers) {
        pc.getTransceivers().forEach((transceiver) => {
            if (transceiver.stop) {
                transceiver.stop();
            }
        });
    }

    // close local audio / video
    pc.getSenders().forEach((sender) => {
        sender.track.stop();
    });

    // close peer connection
    setTimeout(() => {
        pc.close();
    }, 500);
}

function negotiate() {
 return pc.createOffer().then((offer) => {
 return pc.setLocalDescription(offer);
 }).then(() => {
 // wait for the ICE gathering to complete
 return new Promise((resolve)=> {
 if (pc.iceGatheringState=== 'complete') {
 resolve();
 } else  {
 function checkstate() {
 if (pc.iceGatheringState === 'complete') {
 pc.removeEventListener('icegatheringState', checkstate);
 resolve();
 }
  }
  pc.addEventListener('icegatheringstatechange', checkstate);
  }
 });
 }).then(() => {
  var offer = pc.localDescription;
  console.log(offer)
  document.getElementById('offer-sdp').textContent = offer.sdp;
  return fetch('/offer', {
   body: JSON.stringify({
   sdp: offer.sdp,
   type: offer.type,
   video_transform: document.getElementById('video-transform').value}),
   headers: { content_Type: 'application/JSON' },
   method: 'POST'
   });
 }).then((response) =>  {
 return response.json();
 }).then((answer) => {
 document.getElementById('answer-sdp').textContent=answer.sdp;
 return pc.setRemoteDescription(answer);
 }).catch((e) => {
 alert(e);
 })
  console.log('Lets start negotiation with server')
 }

