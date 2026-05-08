import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Database, 
  Network, 
  Zap, 
  Search, 
  Activity, 
  FileText, 
  Globe, 
  Cpu, 
  AlertCircle 
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import KnowledgeGraph from './components/KnowledgeGraph';
import { useAura } from './hooks/useAura';

interface Message {
  role: 'user' | 'agent';
  content: string;
  confidence?: number;
  reasoning?: string;
}

interface Triplet {
  subject: string;
  predicate: string;
  object: string;
}

interface KnowledgeNode {
  id: string;
  type: 'entity' | 'source';
}

interface KnowledgeLink {
  source: string;
  target: string;
  label: string;
}

interface KnowledgeState {
  nodes: KnowledgeNode[];
  links: KnowledgeLink[];
}

let aiInstance: any = null;
const getAI = () => {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is required but not found in environment.");
    aiInstance = new GoogleGenAI({ apiKey: key });
  }
  return aiInstance;
};

export default function App() {
  const [url, setUrl] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState('');
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeState>({ 
    nodes: [
      { id: 'Agent_Alpha', type: 'source' },
      { id: 'Knowledge_Base', type: 'entity' }
    ], 
    links: [
      { source: 'Agent_Alpha', target: 'Knowledge_Base', label: 'initializing' }
    ] 
  });
  const [logs, setLogs] = useState<string[]>(['System initialized.', 'Awaiting signal...']);
  const [currentArtifact, setCurrentArtifact] = useState<string | null>(null);
  const addLog = (msg: string) => setLogs(prev => [msg, ...prev].slice(0, 50));
  
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const aura = useAura();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, aura.transcriptions]);

  useEffect(() => {
    if (aura.error) {
      addLog(`Aura Error: ${aura.error}`);
    }
  }, [aura.error]);

  useEffect(() => {
    if (aura.isConnected) {
      addLog("Aura connected via WebSockets (Live API).");
    } else {
      addLog("Aura disconnected.");
    }
  }, [aura.isConnected]);

  // Sync Voice Transcriptions to main message state
  useEffect(() => {
    if (aura.transcriptions.length > 0) {
      const last = aura.transcriptions[aura.transcriptions.length - 1];
      setMessages(prev => {
        // Prevent duplicate sync if already exists
        const exists = prev.some(m => m.content === last.text && m.role === (last.role === 'user' ? 'user' : 'agent'));
        if (exists) return prev;
        
        return [...prev, { 
          role: last.role === 'user' ? 'user' : 'agent', 
          content: last.text,
          confidence: 100,
          reasoning: 'Synced from Voice Engine'
        }];
      });
    }
  }, [aura.transcriptions]);

  // Aura Voice Assistant Logic
  const toggleVoice = async () => {
    if (aura.isConnected) {
      aura.disconnect();
    } else {
      try {
        const configRes = await fetch('/api/config');
        const configData = await configRes.json();
        const key = configData.geminiKey;
        
        if (key) {
          aura.connect(key, "Zephyr", async (toolCall: any) => {
            if (toolCall.functionCalls) {
              const toolResponses = [];
              for (const fc of toolCall.functionCalls) {
                if (fc.name === 'query_knowledge_graph') {
                  const question = fc.args.question;
                  addLog(`Voice Agent is querying graph for: ${question}`);
                  
                  try {
                    const res = await fetch('/api/query', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ question })
                    });
                    const data = await res.json();
                    toolResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { result: data.answer }
                    });
                  } catch (err) {
                    toolResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { error: "Failed to query knowledge base" }
                    });
                  }
                }
              }
              aura.sendToolResponse({ toolResponse: { functionResponses: toolResponses } });
            }
          });
        } else {
          addLog("Error: API Key not found from server.");
        }
      } catch (err) {
        addLog(`Voice connection error: ${err}`);
      }
    }
  };
  const refreshGraph = async () => {
    try {
      const res = await fetch('/api/graph');
      const data = await res.json();
      if (data.nodes) {
        setKnowledge(data);
      }
    } catch (err) {
      console.error("Failed to refresh graph:", err);
    }
  };

  useEffect(() => {
    refreshGraph();
    // Auto-refresh removed as per user request to prevent graph layout reset
  }, []);

  const extractKnowledge = async (text: string, source: string) => {
    addLog(`Agentic Extraction initiated for ${source}...`);
    
    const chunkSize = 5000;
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }

    let totalTripletsFound = 0;

    for (let i = 0; i < chunks.length; i++) {
      try {
        setProcessingStatus(`Analyzing Segment ${i+1}/${chunks.length}... (${totalTripletsFound} facts found)`);
        const res = await fetch('/api/extract-agentic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: chunks[i], source })
        });
        const data = await res.json();
        const triplets: Triplet[] = data.triplets || [];
        totalTripletsFound += triplets.length;
        
        if (triplets.length > 0) {
          setKnowledge(prev => {
            const newNodes = [...prev.nodes];
            const newLinks = [...prev.links];

            if (!newNodes.find(n => n.id === source)) {
              newNodes.push({ id: source, type: 'source' });
            }

            triplets.forEach(t => {
              if (!newNodes.find(n => n.id === t.subject)) newNodes.push({ id: t.subject, type: 'entity' });
              if (!newNodes.find(n => n.id === t.object)) newNodes.push({ id: t.object, type: 'entity' });
              
              newLinks.push({ source: t.subject, target: t.object, label: t.predicate });
              newLinks.push({ source: t.subject, target: source, label: 'mentioned_in' });
            });

            return { nodes: newNodes, links: newLinks };
          });
        }
      } catch (err) {
        addLog(`Segment ${i+1} extraction error: ${err}`);
      }
    }
    
    setProcessingStatus(null);
    addLog(`Agentic Pipeline complete for ${source}. Found ${totalTripletsFound} facts.`);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    addLog(`Processing file: ${file.name}`);
    setIsIngesting(true);

    if (file.name.endsWith('.pdf')) {
      setProcessingStatus("Uploading PDF...");
      const formData = new FormData();
      formData.append('file', file);
      
      try {
        const res = await fetch('/api/ingest/pdf', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (res.ok && data.message) {
          addLog(`${data.message} (${file.name})`);
          await refreshGraph();
        } else {
          addLog(`PDF Ingestion error: ${data.error || 'Unknown error'}`);
        }
      } catch (err) {
        addLog(`PDF Ingestion failed: ${err}`);
      } finally {
        setProcessingStatus(null);
        setIsIngesting(false);
      }
      return;
    } else {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target?.result as string;
        if (file.name.endsWith('.csv')) {
          const lines = content.split('\n').slice(1);
          const triplets: Triplet[] = lines.filter(l => l.trim()).map(line => {
            const [sub, pred, obj] = line.split(',');
            return { subject: sub?.trim(), predicate: pred?.trim() || 'related_to', object: obj?.trim() };
          });

          setKnowledge(prev => {
            const newNodes = [...prev.nodes];
            const newLinks = [...prev.links];
            if (!newNodes.find(n => n.id === file.name)) newNodes.push({ id: file.name, type: 'source' });
            triplets.forEach(t => {
              if (t.subject && t.object) {
                if (!newNodes.find(n => n.id === t.subject)) newNodes.push({ id: t.subject, type: 'entity' });
                if (!newNodes.find(n => n.id === t.object)) newNodes.push({ id: t.object, type: 'entity' });
                newLinks.push({ source: t.subject, target: t.object, label: t.predicate });
                newLinks.push({ source: t.subject, target: file.name, label: 'contained_in' });
              }
            });
            return { nodes: newNodes, links: newLinks };
          });
          addLog(`Ingested ${triplets.length} records from CSV.`);
        } else {
          await extractKnowledge(content, file.name);
        }
      };
      reader.readAsText(file);
    }
    setIsIngesting(false);
  };

  const handleIngest = async () => {
    if (!url) return;
    setIsIngesting(true);
    addLog(`Initiating multi-source ingestion: ${url}`);
    
    try {
      const res = await fetch('/api/ingest/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      
      if (data.message) {
        addLog(data.message);
        addLog(`Graph Status: ${data.graphSummary}`);
        await refreshGraph();
      }
    } catch (err) {
      addLog(`Ingestion failed: ${err}`);
    } finally {
      setIsIngesting(false);
      setUrl('');
    }
  };

  const handleQuery = async (overrideQuery?: string) => {
    const queryToUse = overrideQuery || query;
    if (!queryToUse) return;
    const userMsg = queryToUse;
    setQuery('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    addLog(`Agentic Query initiated: "${userMsg}"`);

    try {
      addLog("Consulting Neo4j Knowledge Graph for context...");
      
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMsg })
      });
      
      if (!res.ok) {
        throw new Error(`RAG API returned ${res.status}`);
      }
      
      const data = await res.json();
      const answer = data.answer || "I couldn't process that query.";
      const source = data.source || "general_ai";
      
      if (data.context) {
        setCurrentArtifact(data.context);
        addLog("Knowledge Artifact retrieved from Neo4j DB.");
      } else {
        setCurrentArtifact("No context found in Neo4j. Falling back to general AI.");
      }

      setMessages(prev => [...prev, { 
        role: 'agent', 
        content: answer,
        confidence: source === 'knowledge_graph' ? 95 : 60,
        reasoning: `Source: ${source}`
      }]);
      
      addLog(`Query complete. Source: ${source.toUpperCase()}`);
    } catch (err) {
      addLog(`Query error: ${err}`);
      setMessages(prev => [...prev, { 
        role: 'agent', 
        content: "Sorry, the RAG engine encountered an error.",
        confidence: 0
      }]);
    }
  };

  const filteredNodesAndLinks = React.useMemo(() => {
    if (!selectedSource) return knowledge;
    
    const subjectsInSource = new Set(
      knowledge.links
        .filter(l => (l.target === selectedSource && (l.label === 'mentioned_in' || l.label === 'contained_in')))
        .map(l => l.source)
    );
    
    const validLinks = knowledge.links.filter(l => 
      subjectsInSource.has(l.source) || 
      subjectsInSource.has(l.target) ||
      l.source === selectedSource || 
      l.target === selectedSource
    );
    
    const validNodeIds = new Set<string>();
    validNodeIds.add(selectedSource);
    validLinks.forEach(l => {
      validNodeIds.add(l.source);
      validNodeIds.add(l.target);
    });
    
    return {
      nodes: knowledge.nodes.filter(n => validNodeIds.has(n.id)),
      links: validLinks
    };
  }, [knowledge, selectedSource]);

  // Initial Greeting
  useEffect(() => {
    const timer = setTimeout(() => {
      const greeting = "Hello! I am Aura, your Advanced Agentic Voice Assistant. I am ready to analyze your data or answer your queries. How can I help you today?";
      // setMessages([{ role: 'agent', content: greeting, confidence: 100, reasoning: 'Auto-initialized greeting sequence.' }]);
      // auraSpeak(greeting);
      addLog("Aura initialized and greeted user.");
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden bg-zinc-950 text-zinc-300 font-sans">
      {/* Left Sidebar: Ingestion & Control */}
      <aside className="w-64 border-r border-zinc-800 flex flex-col bg-zinc-900">
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/30">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full bg-orange-500"></div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">LlamaLab / Track 4</span>
          </div>
          <h1 className="text-lg font-mono font-bold text-white leading-tight underline decoration-orange-500 decoration-2">KG_AGENT_v1.2</h1>
        </div>

        <div className="p-4 space-y-6 overflow-y-auto">
          {/* Source Ingestion */}
          <div>
            <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-3 font-bold">Multi-Source Ingestion</h3>
            <div className="space-y-2">
              <div className="flex flex-col gap-2 p-2 rounded bg-zinc-900/50 border border-zinc-800">
                <input 
                  type="text" 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="e.g. https://wikipedia.org/wiki/AI"
                  className="bg-black/50 border border-zinc-700 rounded p-1.5 text-xs text-zinc-300 focus:outline-none focus:border-orange-500"
                />
                <button 
                  onClick={handleIngest}
                  disabled={isIngesting}
                  className="w-full py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-bold text-[10px] rounded transition-colors disabled:opacity-50"
                >
                  {isIngesting ? 'INGESTING...' : 'INGEST URL'}
                </button>
              </div>

              {/* Quick Help Tip */}
              <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                <div className="flex items-center gap-2 mb-1 text-blue-400">
                  <AlertCircle className="w-3 h-3" />
                  <span className="text-[9px] font-bold uppercase">Pro Tip</span>
                </div>
                <p className="text-[9px] text-zinc-500 leading-tight">
                  Aap kisi bhi informative site ka link daal saktay hain. Hamara <b>Gemini Engine</b> usay scan kar ke graph bana de ga.
                </p>
              </div>
              
              <label className="flex items-center justify-between p-2 rounded bg-zinc-900/50 border border-zinc-800 cursor-pointer hover:border-emerald-500/50 transition-colors group">
                <div className="flex items-center gap-2">
                  <FileText className="w-3 h-3 text-emerald-400" />
                  <span className="text-[10px] text-zinc-400 group-hover:text-emerald-400 transition-colors">Upload Data (CSV/TXT)</span>
                </div>
                <input 
                  type="file" 
                  className="hidden" 
                  accept=".csv,.txt,.pdf"
                  onChange={handleFileUpload}
                  disabled={isIngesting}
                />
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-700 group-hover:bg-emerald-500"></div>
              </label>
            </div>
          </div>

          {/* Active Sources */}
          {knowledge.nodes.filter(n => n.type === 'source').length > 0 && (
            <div>
              <h3 className="text-[10px] uppercase tracking-wider text-emerald-500 mb-3 font-bold">Active Sources</h3>
              <div className="space-y-1">
                {knowledge.nodes.filter(n => n.type === 'source').map(source => (
                  <div key={source.id} className="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800 group">
                    <span className="text-[9px] text-zinc-400 truncate max-w-[140px]">{source.id}</span>
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Knowledge Analytics */}
          <div>
            <h3 className="text-[10px] uppercase tracking-wider text-blue-500 mb-3 font-bold">Graph Analytics</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-zinc-900 border border-zinc-800 rounded">
                <div className="text-[8px] text-zinc-500 uppercase">Avg Connectivity</div>
                <div className="text-xs font-mono text-white">
                  {(knowledge.links.length / (knowledge.nodes.length || 1)).toFixed(2)}
                </div>
              </div>
              <div className="p-2 bg-zinc-900 border border-zinc-800 rounded">
                <div className="text-[8px] text-zinc-500 uppercase">Clustering</div>
                <div className="text-xs font-mono text-white">0.42</div>
              </div>
            </div>
            <div className="mt-2 p-2 bg-zinc-900 border border-zinc-800 rounded">
              <div className="text-[8px] text-zinc-500 uppercase mb-1">Entity Dominance</div>
              <div className="flex gap-1">
                <div className="h-1 bg-emerald-500 flex-1 rounded-full"></div>
                <div className="h-1 bg-blue-500 w-1/3 rounded-full"></div>
                <div className="h-1 bg-orange-500 w-1/4 rounded-full"></div>
              </div>
            </div>
          </div>

          {/* Aura Voice Assistant Module */}
          <div>
            <h3 className="text-[10px] uppercase tracking-wider text-orange-500 mb-3 font-bold">Aura Engine (Live)</h3>
            <div className={`p-4 rounded-lg border flex flex-col items-center gap-3 transition-all ${aura.isConnected ? 'bg-orange-500/20 border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.3)]' : 'bg-zinc-900 border-zinc-800'}`}>
              <div className="relative">
                {aura.isConnected && (
                  <motion.div 
                    className="absolute inset-0 bg-blue-500 rounded-full blur-xl opacity-50"
                    style={{ scale: 1 + aura.micVolume * 2 }}
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                  />
                )}
                <button 
                  onClick={toggleVoice}
                  className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all ${aura.isConnected ? 'bg-white text-orange-500 scale-110 shadow-[0_0_20px_rgba(255,255,255,0.4)]' : 'bg-orange-600 text-white hover:bg-orange-500'}`}
                >
                  <Cpu className={`w-6 h-6 ${aura.isConnected ? 'animate-pulse' : ''}`} />
                </button>
              </div>
              <div className="text-center">
                <span className="text-[10px] font-mono text-zinc-400 block uppercase mb-1">Status: {aura.isConnected ? 'CONNECTED_LIVE' : 'DISCONNECTED'}</span>
                {aura.isConnected && <div className="text-[9px] text-orange-400 font-bold animate-pulse">AURA: "I'm listening..."</div>}
              </div>
            </div>
          </div>

          {/* System Telemetry */}
          <div>
            <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-3 font-bold">System Telemetry</h3>
            <div className="p-3 bg-black/40 border border-zinc-800 rounded font-mono text-[9px] h-48 overflow-y-auto space-y-1.5">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-zinc-600">[{new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                  <span className={log.includes('error') ? 'text-red-400' : 'text-zinc-400'}>{log}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-auto p-4 border-t border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center justify-between text-[10px] font-mono mb-2">
             <span className="text-zinc-500">MEMORY STATUS</span>
             <span className="text-emerald-500">12.4GB / OPTIMAL</span>
          </div>
          <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
             <motion.div 
               className="h-full bg-emerald-500" 
               initial={{ width: "30%" }} 
               animate={{ width: "65%" }}
               transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
             />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative">
        {/* Header Metrics */}
        <header className="h-16 border-b border-zinc-800 flex items-center px-6 gap-8 bg-zinc-900/10 backdrop-blur-sm relative z-40">
          <div>
            <span className="text-[10px] text-zinc-500 block uppercase font-bold tracking-tight">Nodes Extracted</span>
            <span className="text-xl font-mono text-orange-400 font-bold">{knowledge.nodes.length}</span>
          </div>
          <div className="w-px h-8 bg-zinc-800"></div>
          <div>
            <span className="text-[10px] text-zinc-500 block uppercase font-bold tracking-tight">Triplet Density</span>
            <span className="text-xl font-mono text-white">{(knowledge.links.length / (knowledge.nodes.length || 1)).toFixed(2)} <span className="text-[10px] text-zinc-500 font-normal">t/n</span></span>
          </div>
          <div className="w-px h-8 bg-zinc-800"></div>
          <div>
            <span className="text-[10px] text-zinc-500 block uppercase font-bold tracking-tight">RAG Analysis Range</span>
            <span className="text-xl font-mono text-blue-400 font-bold">DEEP_SCAN</span>
          </div>
          <div className="w-px h-8 bg-zinc-800"></div>
          <div className="flex-1 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase font-bold tracking-tight">Active Artifact</span>
              <span className="text-[10px] font-mono text-emerald-400 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-sm">
                {currentArtifact ? `ARTIFACT_SNAPSHOT_${new Date().getTime().toString().slice(-4)}` : 'NULL_STATE'}
              </span>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => {
                  addLog("Manually refreshing graph data...");
                  refreshGraph();
                }}
                className="text-[10px] font-bold bg-zinc-800 hover:bg-orange-600 text-zinc-400 hover:text-white px-3 py-1 rounded border border-zinc-700 hover:border-orange-500 transition-all uppercase flex items-center gap-1"
              >
                <Activity className="w-3 h-3" /> Refresh Data
              </button>
              <button 
                onClick={() => {
                  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(knowledge));
                  const downloadAnchorNode = document.createElement('a');
                  downloadAnchorNode.setAttribute("href",     dataStr);
                  downloadAnchorNode.setAttribute("download", "knowledge_graph.json");
                  document.body.appendChild(downloadAnchorNode);
                  downloadAnchorNode.click();
                  downloadAnchorNode.remove();
                  addLog("Exported Knowledge Graph to JSON.");
                }}
                className="text-[10px] font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white px-3 py-1 rounded border border-zinc-700 transition-all uppercase"
              >
                Export JSON
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Graph Visualization Space */}
          <div className="flex-1 relative graph-grid bg-[#0a0a0c]">
            {/* Processing Indicator Overlay */}
            <AnimatePresence>
              {processingStatus && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                >
                  <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl">
                    <div className="relative">
                      <motion.div 
                        className="w-16 h-16 rounded-full border-4 border-orange-500/20 border-t-orange-500"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      />
                      <motion.div 
                        className="absolute inset-0 flex items-center justify-center"
                        animate={{ opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <Database className="w-6 h-6 text-orange-500" />
                      </motion.div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-white mb-1 uppercase tracking-widest">{processingStatus}</div>
                      <div className="text-[10px] text-zinc-500 font-mono">Syncing with Knowledge Graph...</div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <KnowledgeGraph nodes={filteredNodesAndLinks.nodes} links={filteredNodesAndLinks.links} />
            
            <div className="absolute top-4 left-4 p-3 bg-zinc-900/90 border border-zinc-800 rounded backdrop-blur-sm z-10">
              <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mb-1.5 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></div> Graph Engine Active
              </div>
              <div className="space-y-0.5">
                <div className="text-[10px] font-mono text-zinc-400 flex justify-between gap-4">
                  <span>ENTITIES:</span> <span className="text-white">{knowledge.nodes.filter(n => n.type === 'entity').length}</span>
                </div>
                <div className="text-[10px] font-mono text-zinc-400 flex justify-between gap-4">
                  <span>RELATIONS:</span> <span className="text-white">{knowledge.links.length}</span>
                </div>
              </div>
            </div>

            {/* Graph Source Filter Box (Top Right) */}
            <div className="absolute top-4 right-4 p-3 bg-zinc-900/90 border border-zinc-800 rounded backdrop-blur-sm z-10 w-48 max-h-64 overflow-y-auto shadow-xl">
              <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mb-2 border-b border-zinc-800 pb-1 flex justify-between items-center">
                <span>Filter by File</span>
                <span className="text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded">{knowledge.nodes.filter(n => n.type === 'source').length}</span>
              </div>
              <div className="space-y-1">
                <button 
                  onClick={() => setSelectedSource(null)}
                  className={`w-full text-left px-2 py-1.5 rounded text-[10px] truncate transition-colors ${!selectedSource ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'text-zinc-400 hover:bg-zinc-800'}`}
                >
                  Show All (Entire Graph)
                </button>
                {knowledge.nodes.filter(n => n.type === 'source').map(source => (
                  <button
                    key={source.id}
                    onClick={() => setSelectedSource(source.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-[10px] truncate transition-colors ${selectedSource === source.id ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'text-zinc-400 hover:bg-zinc-800'}`}
                    title={source.id}
                  >
                    {source.id}
                  </button>
                ))}
              </div>
            </div>

            {/* Knowledge Artifact Overlay (Bottom) */}
            <AnimatePresence>
              {currentArtifact && (
                <motion.div 
                  initial={{ y: 100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 100, opacity: 0 }}
                  className="absolute bottom-6 left-6 right-6 p-4 bg-zinc-900/95 border border-zinc-800 rounded-lg shadow-2xl backdrop-blur-md z-20 max-h-48 overflow-y-auto"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[9px] font-bold text-orange-500 uppercase tracking-widest flex items-center gap-2">
                      <Zap className="w-3 h-3" /> Compiled Knowledge Artifact
                    </div>
                    <button onClick={() => setCurrentArtifact(null)} className="text-zinc-600 hover:text-white">
                      <Search className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-xs text-zinc-400 leading-relaxed font-mono">
                    {currentArtifact}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Sidebar: Agentic Chat */}
          <div className="w-80 border-l border-zinc-800 flex flex-col bg-zinc-900">
            <div className="p-3 border-b border-zinc-800 bg-zinc-900/30 flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Neural Query Engine</span>
              <span className="px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 text-[9px] font-mono border border-orange-500/20">GRAPH_RAG</span>
            </div>

            <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-4">
              {messages.length === 0 && aura.transcriptions.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-center p-6 grayscale opacity-20">
                  <Activity className="w-16 h-16 text-zinc-500" />
                </div>
              )}
              
              {/* Render Static Chat Messages */}
              {messages.map((m, i) => (
                <div key={`msg-${i}`} className={`flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className="text-[8px] font-mono text-zinc-600 uppercase flex items-center gap-2">
                    {m.role === 'user' ? 'MASTER_NODE' : 'AGENT_NODE'}
                  </div>
                  <div className={`p-3 rounded text-[11px] leading-relaxed border ${
                    m.role === 'user' 
                      ? 'bg-zinc-800 border-zinc-700 text-zinc-200 ml-8' 
                      : 'bg-zinc-900/50 border-orange-500/30 text-zinc-100 border-l-2 border-l-orange-500 mr-8'
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}

              {/* Render LIVE Voice Transcriptions */}
              {aura.transcriptions.map((m, i) => (
                <div key={`live-${i}`} className={`flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className="text-[8px] font-mono text-orange-500/70 uppercase flex items-center gap-2">
                    {m.role === 'user' ? 'USER_VOICE' : 'AURA_LIVE'}
                    <span className="w-1 h-1 rounded-full bg-orange-500 animate-ping"></span>
                  </div>
                  <div className={`p-3 rounded text-[11px] leading-relaxed border border-dashed ${
                    m.role === 'user' 
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-300 ml-8' 
                      : 'bg-orange-500/5 border-orange-500/40 text-white mr-8'
                  }`}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
              <div className="relative group">
                <input 
                  type="text" 
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
                  placeholder="QUERY_KNOWLEDGE_BASE..." 
                  className="w-full bg-zinc-950 border border-zinc-700 rounded p-2.5 text-[11px] text-zinc-300 focus:outline-none focus:border-orange-500 transition-all font-mono"
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-zinc-600 font-mono pointer-events-none group-focus-within:text-orange-500/50">
                  ENT
                </div>
              </div>
              <div className="mt-3 flex justify-between items-center opacity-50">
                <div className="flex gap-2">
                  <div className="w-4 h-4 rounded border border-zinc-700 flex items-center justify-center text-[7px] text-zinc-500 cursor-help hover:border-zinc-500 transition-colors">?</div>
                  <div className="w-4 h-4 rounded border border-zinc-700 flex items-center justify-center text-[7px] text-zinc-500 cursor-pointer hover:border-zinc-500 transition-colors">SET</div>
                </div>
                <div className="text-[8px] text-zinc-700 font-mono uppercase tracking-tighter">GEMINI-3-FLASH</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
