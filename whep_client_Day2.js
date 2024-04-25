const restartPause = 2000;
const DEST = 'https://emqx.cloudgcs.com:9989/';
const VEHICLE = 'UCD-CGT50-102/';
const PROTOCOL = 'whep';

var dataChannelLog = document.getElementById('data-channel'),
    iceConnectionLog = document.getElementById('ice-connection-state'),
    iceGatheringLog = document.getElementById('ice-gathering-state'),
    signalingLog = document.getElementById('signaling-state');

//var pc = null;
////data channel
var dc = null, dcInterval= null;

const unquoteCredential = (v) => (
    JSON.parse(`"${v}"`)
);

const linkToIceServers = (links) => (
    (links !== null) ? links.split(', ').map((link) => {
        const m = link.match(/^<(.+?)>; rel="ice-server"(; username="(.*?)"; credential="(.*?)"; credential-type="password")?/i);
        const ret = {
            urls: [m[1]],
        };

        if (m[3] !== undefined) {
            ret.username = unquoteCredential(m[3]);
            ret.credential = unquoteCredential(m[4]);
            ret.credentialType = "password";
        }

        return ret;
    }) : []
);

const parseOffer = (offer) => {
    const ret = {
        iceUfrag: '',
        icePwd: '',
        medias: [],
    };

    for (const line of offer.split('\r\n')) {
        if (line.startsWith('m=')) {
            ret.medias.push(line.slice('m='.length));
        } else if (ret.iceUfrag === '' && line.startsWith('a=ice-ufrag:')) {
            ret.iceUfrag = line.slice('a=ice-ufrag:'.length);
        } else if (ret.icePwd === '' && line.startsWith('a=ice-pwd:')) {
            ret.icePwd = line.slice('a=ice-pwd:'.length);
        }
    }

    return ret;
};

const enableStereoOpus = (section) => {
    let opusPayloadFormat = '';
    let lines = section.split('\r\n');

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('a=rtpmap:') && lines[i].toLowerCase().includes('opus/')) {
            opusPayloadFormat = lines[i].slice('a=rtpmap:'.length).split(' ')[0];
            break;
        }
    }

    if (opusPayloadFormat === '') {
        return section;
    }

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('a=fmtp:' + opusPayloadFormat + ' ')) {
            if (!lines[i].includes('stereo')) {
                lines[i] += ';stereo=1';
            }
            if (!lines[i].includes('sprop-stereo')) {
                lines[i] += ';sprop-stereo=1';
            }
        }
    }

    return lines.join('\r\n');
};

const editOffer = (offer) => {
    const sections = offer.sdp.split('m=');

    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (section.startsWith('audio')) {
            sections[i] = enableStereoOpus(section);
        }
    }

    offer.sdp = sections.join('m=');
};

const generateSdpFragment = (offerData, candidates) => {
    const candidatesByMedia = {};
    for (const candidate of candidates) {
        const mid = candidate.sdpMLineIndex;
        if (candidatesByMedia[mid] === undefined) {
            candidatesByMedia[mid] = [];
        }
        candidatesByMedia[mid].push(candidate);
    }

    let frag = 'a=ice-ufrag:' + offerData.iceUfrag + '\r\n'
        + 'a=ice-pwd:' + offerData.icePwd + '\r\n';

    let mid = 0;

    for (const media of offerData.medias) {
        if (candidatesByMedia[mid] !== undefined) {
            frag += 'm=' + media + '\r\n'
                + 'a=mid:' + mid + '\r\n';

            for (const candidate of candidatesByMedia[mid]) {
                frag += 'a=' + candidate.candidate + '\r\n';
            }
        }
        mid++;
    }

    return frag;
}

class WHEPClient {
    constructor(video) {
        this.video = video;
        this.pc = null;
        this.restartTimeout = null;
        this.sessionUrl = '';
        this.sessionID = '';
        this.queuedCandidates = [];
        this.start1();
        this.sending();
    }

    start1() {
        console.log("requesting ICE servers");

        fetch(new URL(DEST + VEHICLE + PROTOCOL, window.location.href) + window.location.search, {
            method: 'OPTIONS',
        })
            .then((res) => {
            this.onIceServers(res);
            this.sending();
            })
            .catch((err) => {
                console.log('error: ' + err);
                this.scheduleRestart();
                this.sending();

            });
    }

    onIceServers(res) {
        this.pc = new RTCPeerConnection({
            iceServers: linkToIceServers(res.headers.get('Link')),
        });

        const direction = "sendrecv";
        this.pc.addTransceiver("video", { direction });
        this.pc.addTransceiver("audio", { direction });

        this.pc.onicecandidate = (evt) => this.onLocalCandidate(evt);
        this.pc.oniceconnectionstatechange = () => this.onConnectionState();

        console.log('add more generalizing parameters: ')
        this.pc.addEventListener('icegatheringstatechange', () => {
            iceGatheringLog.textContent += ' => ' + this.pc.iceGatheringState;
             }, false);
             iceGatheringLog.textConent = this.pc.iceGatheringState;

            this.pc.addEventListener('iceconnectionstatechange', () => {
              iceConnectionLog.textContent   += ' --> ' + this.pc.iceConnectionState;
            }, false);
            iceConnectionLog.textContent  = this.pc.iceConnectionState;

            this.pc.addEventListener('singallingstatechange', () => {
               signalingLog.textContent  += ' -=-> ' + this.pc.signalingState;
            }, false);

            signalingLog = this.pc.signalingState;

             console.log('The pc includes....' + this.pc)
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

            if (constraints.audio || constraints.video) {
                if (constraints.video) {
                    document.getElementById('media').style.display = 'block';
                      }

            this.pc.addEventListener('track', (evt) => {
                if (evt.track.kind == 'video')
                document.getElementById('video').srcObject = evt.streams[0];

                else
                   document.getElementById('audio').srcObject = evt.stream[0];
                });
               console.log('---PC sucessfully received the audio and video Files....')
               // return this.pc

             this.pc.ontrack = (evt) => {
                console.log("new track:", evt.track.kind);
                this.video.srcObject = evt.streams[0];
                console.log(evt.streams[0])
                //this.pc.addTrack(evt.streams[0]);
                console.log("video link",this.video.srcObject);
            };
         }
        this.pc.createOffer()
            .then((offer) => {
            this.onLocalOffer(offer);
            return this.pc.setLocalDescription(offer);
            }).then(()=> {
            // wait for the ICE gathering to complete
                 console.log('added---------------')
                 console.log(this.pc.iceGatheringState)
                 return new Promise((resolve) => {
                 if (this.pc.iceGatheringState=== 'complete') {
                 resolve();
                 }  else  {
                 function checkstate() {
                 if (this.pc.iceGatheringState === 'complete') {
                 //this.pc.removeEventListener('icegatheringstate', checkstate);
                 resolve();

                 }
                  }
                  // this.pc.addEventListener('icegatheringstatechange', checkstate);
                   console.log('Check State')
                  }
                 });
                 }).then(() => {
                  var offer = this.pc.localDescription;
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
                 return this.pc.setRemoteDescription(answer);
                 }).catch((e) => {
                 alert(e);
            })
            console.log('Lets start negotiation with server')
    }

    onLocalOffer(offer) {
       // editOffer(offer);
         console.log(offer)
        this.offerData = parseOffer(offer.sdp);
        this.pc.setLocalDescription(offer);

        console.log("sending offer");

        fetch(new URL(DEST + VEHICLE + PROTOCOL, window.location.href) + window.location.search, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/sdp',
            },
            body: offer.sdp,
        })
            .then((res) => {
                if (res.status !== 201) {
                    throw new Error('bad status code');
                }
                this.sessionUrl = new URL(res.headers.get('location'), window.location.href).toString();
                this.sessionID = res.headers.get('location');
                return res.text();
            })
            .then((sdp) => this.onRemoteAnswer(new RTCSessionDescription({
                type: 'answer',
                sdp,
            })))
            .catch((err) => {
                console.log('error: ' + err);
                this.scheduleRestart();


            });
    }

    onConnectionState() {
        if (this.restartTimeout !== null) {
            return;
        }

        console.log("peer connection state:", this.pc.iceConnectionState);

        switch (this.pc.iceConnectionState) {
        case "disconnected":
            this.scheduleRestart();


        }
    }

    onRemoteAnswer(answer) {
        if (this.restartTimeout !== null) {
            return;
        }

        this.pc.setRemoteDescription(answer);

        if (this.queuedCandidates.length !== 0) {
            this.sendLocalCandidates(this.queuedCandidates);
            this.queuedCandidates = [];
        }
    }

    onLocalCandidate(evt) {
        if (this.restartTimeout !== null) {
            return;
        }

        if (evt.candidate !== null) {
            if (this.sessionUrl === '') {
                this.queuedCandidates.push(evt.candidate);
            } else {
                this.sendLocalCandidates([evt.candidate])
            }
        }
    }

    sendLocalCandidates(candidates) {
        //fetch(this.sessionUrl + window.location.search, {
        fetch(DEST + VEHICLE + this.sessionID + window.location.search, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/trickle-ice-sdpfrag',
                'If-Match': '*',
            },
            body: generateSdpFragment(this.offerData, candidates),
        })
            .then((res) => {
                if (res.status !== 204) {
                    throw new Error('bad status code');
                }
            })
            .catch((err) => {
                console.log('error: ' + err);
                this.scheduleRestart();
                this.sending()

            });
    }

    scheduleRestart() {
        if (this.restartTimeout !== null) {
            return;
        }

        if (this.pc !== null) {
            this.pc.close();
            this.pc = null;
        }

        this.restartTimeout = window.setTimeout(() => {
            this.restartTimeout = null;
            this.start();
        }, restartPause);

        if (this.sessionUrl) {
            //fetch(this.sessionUrl, {
            fetch(DEST + VEHICLE + this.sessionID, {
                method: 'DELETE',
            })
                .then((res) => {
                    if (res.status !== 200) {
                        throw new Error('bad status code');
                    }
                })
                .catch((err) => {
                    console.log('delete session error: ' + err);
                });
        }
        this.sessionUrl = '';

        this.queuedCandidates = [];
        this.sending();
    }
    sending()  {
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

          dc = this.pc.createDataChannel('chat', parameters);
          console.log(dc)
          dc.addEventListener('close',() => {
          clearInterval(dcInterval);
          dataChannelLog.textContent += '- close\n';
          });
          dc.addEventListener('open', () => {
          dataChannelLog.textContent += '- open\n';
          dcInterval = setInterval(() => {
          var message = "ping : " + current_stamp();
          dataChannelLog.textContent += '>' + message + '\n';
          dc.send(message);
          }, 1000)
          });
          dc.addEventListener('message', (evt) => {
          //console.log(evt.data)
          dataChannelLog.textContent  += '<' + evt.data + '\n';
           if (evt.data.substring(0, 4) === 'pong') {
              var elapsed_ms = current_stamp()- parseInt(evt.data.substring(5), 10);
              console.log('The elapsed_ms is ' , elapsed_ms);
              dataChannelLog.textContent  += 'RTT' + elapsed_ms + 'ms\n'
           }
          });
        console.log('The input message delivering agent  is: ', dc)
        console.log('--------Elapsed time is Calculated when transmitting the dataset.---------')
         }
    }
}

/**
 * Parses the query string from a URL into an object representing the query parameters.
 * If no URL is provided, it uses the query string from the current page's URL.
 *
 * @param {string} [url=window.location.search] - The URL to parse the query string from.
 * @returns {Object} An object representing the query parameters with keys as parameter names and values as parameter values.
 */
 const parseQueryString = (url) => {
    const queryString = (url || window.location.search).split("?")[1];
    if (!queryString) return {};

    const paramsArray = queryString.split("&");
    const result = {};

    for (let i = 0; i < paramsArray.length; i++) {
        const param = paramsArray[i].split("=");
        const key = decodeURIComponent(param[0]);
        const value = decodeURIComponent(param[1] || "");

        if (key) {
            if (result[key]) {
                if (Array.isArray(result[key])) {
                    result[key].push(value);
                } else {
                    result[key] = [result[key], value];
                }
            } else {
                result[key] = value;
            }
        }
    }

    return result;
};

/**
 * Parses a string with boolean-like values and returns a boolean.
 * @param {string} str The string to parse
 * @param {boolean} defaultVal The default value
 * @returns {boolean}
 */
const parseBoolString = (str, defaultVal) => {
    const trueValues = ["1", "yes", "true"];
    const falseValues = ["0", "no", "false"];
    str = (str || "").toString();

    if (trueValues.includes(str.toLowerCase())) {
        return true;
    } else if (falseValues.includes(str.toLowerCase())) {
        return false;
    } else {
        return defaultVal;
    }
};

/**
 * Sets video attributes based on query string parameters or default values.
 *
 * @param {HTMLVideoElement} video - The video element on which to set the attributes.
 */
const setVideoAttributes = (video) => {
    let qs = parseQueryString();

    video.controls = parseBoolString(qs["controls"], true);
    video.muted = parseBoolString(qs["muted"], true);
    video.autoplay = parseBoolString(qs["autoplay"], true);
    video.playsInline = parseBoolString(qs["playsinline"], true);
};

/**
 *
 * @param {(video: HTMLVideoElement) => void} callback
 * @param {HTMLElement} container
 * @returns
 */
const initVideoElement = (callback, container) => {
    return () => {
        const video = document.createElement("video");
        video.id = "video";

        setVideoAttributes(video);
        container.append(video);
        callback(video);
    };
};


function start() {
document.getElementById('start').style.display='none';
window.addEventListener('DOMContentLoaded', initVideoElement((video) => start(video), new WHEPClient(video), document.body));

}