import { GoogleGenAI, Modality } from "@google/genai";
import { arrayBufferToBase64, floatTo16BitPCM } from "./audio-utils.ts";

export interface AuraClientConfig {
  apiKey: string;
  systemInstruction?: string;
  voice?: "Puck" | "Charon" | "Kore" | "Fenrir" | "Zephyr";
  tools?: any[];
}

export interface AuraCallbacks {
  onAudioData: (base64Audio: string) => void;
  onTranscription: (text: string, role: "user" | "model") => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (error: any) => void;
  onInterrupted: () => void;
  onVolumeChange: (volume: number) => void;
  onToolCall?: (toolCall: any) => void;
}

export class AuraLiveClient {
  private ai: any;
  private sessionPromise: Promise<any> | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private callbacks: AuraCallbacks;

  constructor(config: AuraClientConfig, callbacks: AuraCallbacks) {
    if (!config.apiKey) {
      console.warn("Aura: No API key provided.");
    }
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.callbacks = callbacks;
  }

  async connect(config: AuraClientConfig) {
    if (!config.apiKey) {
      this.callbacks.onError(new Error("API Key is missing."));
      return;
    }

    try {
      this.sessionPromise = this.ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
            this.callbacks.onConnected();
            this.startMic();
          },
          onmessage: async (message: any) => {
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  this.callbacks.onAudioData(part.inlineData.data);
                }
                if (part.text) {
                  this.callbacks.onTranscription(part.text, "model");
                }
              }
            }

            if (message.serverContent?.userTurn?.parts) {
              for (const part of message.serverContent.userTurn.parts) {
                if (part.text) {
                  this.callbacks.onTranscription(part.text, "user");
                }
              }
            }

            if (message.serverContent?.interrupted) {
              this.callbacks.onInterrupted();
            }

            if (message.toolCall) {
              this.callbacks.onToolCall?.(message.toolCall);
            }
          },
          onclose: () => {
            this.callbacks.onDisconnected();
            this.stopMic();
          },
          onerror: (error: any) => {
            this.callbacks.onError(error);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice || "Zephyr" } },
          },
          systemInstruction: config.systemInstruction || "You are Aura, a professional AI receptionist.",
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: config.tools || [],
        },
      });

      await this.sessionPromise;
    } catch (error) {
      this.callbacks.onError(error);
    }
  }

  private async startMic() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      
      this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);
      
      let lastInterruptionTime = 0;
      const INTERRUPTION_COOLDOWN = 1000; 

      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        this.callbacks.onVolumeChange(rms);
        const now = Date.now();
        
        if (rms > 0.12 && (now - lastInterruptionTime) > INTERRUPTION_COOLDOWN) {
            this.callbacks.onInterrupted();
            lastInterruptionTime = now;
        }

        const pcm16 = floatTo16BitPCM(inputData);
        const base64 = arrayBufferToBase64(pcm16.buffer);
        
        if (this.sessionPromise) {
          this.sessionPromise.then((session) => {
            try {
              session.sendRealtimeInput({
                audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
              });
            } catch (err) {
            }
          }).catch(err => {
          });
        }
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
    } catch (error) {
      this.callbacks.onError(error);
    }
  }

  private stopMic() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  disconnect() {
    if (this.sessionPromise) {
      this.sessionPromise.then(s => s.close());
      this.sessionPromise = null;
    }
    this.stopMic();
  }

  async sendToolResponse(toolResponse: any) {
    if (this.sessionPromise) {
      const session = await this.sessionPromise;
      session.send(toolResponse);
    }
  }
}
