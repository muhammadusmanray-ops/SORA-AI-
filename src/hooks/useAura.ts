import { useEffect, useRef, useState } from 'react';
import { AuraCallbacks, AuraLiveClient } from '../lib/aura-client';

export function useAura() {
  const [isConnected, setIsConnected] = useState(false);
  const [transcriptions, setTranscriptions] = useState<{ text: string, role: 'user' | 'model', timestamp: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<AuraLiveClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const [micVolume, setMicVolume] = useState(0);

  const stopAllPlayback = () => {
    activeSourcesRef.current.forEach(source => {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {
      }
    });
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0;
  };

  const playAudio = async (base64Audio: string) => {
    try {
      if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }

      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Int16Array(len / 2);
      const view = new DataView(new ArrayBuffer(len));
      for (let i = 0; i < len; i++) {
          view.setUint8(i, binaryString.charCodeAt(i));
      }
      for (let i = 0; i < bytes.length; i++) {
          bytes[i] = view.getInt16(i * 2, true);
      }

      const float32 = new Float32Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
          float32[i] = bytes[i] / 32768;
      }

      const audioBuffer = audioContextRef.current.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);

      activeSourcesRef.current.push(source);
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
      };

      const now = audioContextRef.current.currentTime;
      if (nextStartTimeRef.current < now) {
        nextStartTimeRef.current = now;
      }
      
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;
    } catch (err) {
      console.error("Audio Playback Error:", err);
    }
  };

  const connect = (apiKey: string, voice: any, onToolCall?: (toolCall: any) => void) => {
    const callbacks: AuraCallbacks = {
      onAudioData: (base64) => playAudio(base64),
      onInterrupted: () => {
        stopAllPlayback();
      },
      onTranscription: (text, role) => {
        setTranscriptions(prev => [...prev, { text, role, timestamp: Date.now() }]);
      },
      onVolumeChange: (vol) => setMicVolume(vol),
      onConnected: () => setIsConnected(true),
      onDisconnected: () => setIsConnected(false),
      onError: (err) => {
        console.error("Aura Error:", err);
        setError(err.message || String(err));
      },
      onToolCall: (toolCall) => onToolCall?.(toolCall)
    };

    clientRef.current = new AuraLiveClient({ 
        apiKey, 
        voice,
        systemInstruction: `You are Aura, an elite Agentic AI Voice Assistant for LlamaGraph. 
        Your goal is to handle knowledge extraction and RAG queries with a warm, human-like touch.
        
        CRITICAL RULES:
        1. YOU ARE CONNECTED TO THE DATABASE: You are fully connected to the LlamaGraph Neo4j Graph Database and LanceDB Vector Database. If the user asks if you are connected, say YES enthusiastically.
        2. ALWAYS USE YOUR TOOL: You CANNOT see the user's data directly in your prompt. You MUST ALWAYS call the 'query_knowledge_graph' tool to fetch answers about bank statements, PDF data, or any user questions. Never say "I don't have access". Just use the tool!
        3. CITE SOURCES: When the tool returns information, mention the source it came from.
        4. MULTI-LINGUAL: Native fluency in English, Hindi, and Urdu.
        5. ROMAN URDU: Always speak Roman Urdu for natural pronunciation when speaking Urdu/Hindi.
        
        Stay sharp, be confident that you can access the database via your tool, and always try to use the tool when asked a factual question.`
    }, callbacks);
    clientRef.current.connect({ 
        apiKey, 
        voice,
        tools: [
          {
            functionDeclarations: [
              {
                name: "query_knowledge_graph",
                description: "Query the LlamaGraph Knowledge Base (Neo4j and LanceDB) to get factual information about entities and relationships.",
                parameters: {
                  type: "object",
                  properties: {
                    question: {
                      type: "string",
                      description: "The specific question or topic to search for in the knowledge base."
                    }
                  },
                  required: ["question"]
                }
              }
            ]
          }
        ]
    });
  };

  const disconnect = () => {
    clientRef.current?.disconnect();
    setIsConnected(false);
  };

  const sendToolResponse = (toolResponse: any) => {
    clientRef.current?.sendToolResponse(toolResponse);
  };

  return {
    isConnected,
    transcriptions,
    error,
    micVolume,
    connect,
    disconnect,
    sendToolResponse
  };
}
