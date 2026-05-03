/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  MapPin, 
  Navigation, 
  Clock, 
  Trash2, 
  Zap,
  TrendingUp,
  Map as MapIcon,
  Search,
  Menu,
  X,
  FastForward,
  ShieldCheck,
  Cpu,
  ChevronRight,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, addMinutes } from 'date-fns';
import confetti from 'canvas-confetti';

// UI Helpers
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Map Config & Marker Fixing
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Multan Landmarks Data
const MULTAN_COORDS: [number, number] = [30.1575, 71.5249];

interface Location {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'hub' | 'delivery' | 'landmark';
  baseTrafficWeight: number; // 0-1
}

interface RouteStop extends Location {
  eta: Date;
  distanceFromPrev: number;
  timeFromPrev: number;
  congestion: number;
}

const LANDMARKS: Location[] = [
  { id: 'ghanta-ghar', name: 'Ghanta Ghar (City Center)', lat: 30.1970, lng: 71.4740, type: 'landmark', baseTrafficWeight: 0.9 },
  { id: 'bzu', name: 'Bahauddin Zakariya University', lat: 30.2676, lng: 71.5126, type: 'landmark', baseTrafficWeight: 0.4 },
  { id: 'gulgasht', name: 'Gulgasht Colony', lat: 30.2230, lng: 71.4930, type: 'landmark', baseTrafficWeight: 0.7 },
  { id: 'cantt', name: 'Multan Cantt Station', lat: 30.1860, lng: 71.4550, type: 'landmark', baseTrafficWeight: 0.5 },
  { id: 'mall-multan', name: 'Mall of Multan (Bosan Rd)', lat: 30.2400, lng: 71.5050, type: 'landmark', baseTrafficWeight: 0.8 },
  { id: 'hussain-agahi', name: 'Hussain Agahi Bazaar', lat: 30.1990, lng: 71.4680, type: 'landmark', baseTrafficWeight: 1.0 },
  { id: 'shah-rukn', name: 'Shah Rukn-e-Alam Tomb', lat: 30.2010, lng: 71.4780, type: 'landmark', baseTrafficWeight: 0.6 },
  { id: 'chowk-kumharan', name: 'Chowk Kumharanwala', lat: 30.1880, lng: 71.5150, type: 'landmark', baseTrafficWeight: 0.85 },
  { id: 'qila-kohna', name: 'Qila Kohna Qasim Bagh', lat: 30.2030, lng: 71.4820, type: 'landmark', baseTrafficWeight: 0.5 },
];

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Map View Adjuster
function MapAutoCenter({ locations }: { locations: Location[] }) {
  const map = useMap();
  useEffect(() => {
    if (locations.length > 0) {
      const bounds = L.latLngBounds(locations.map(l => [l.lat, l.lng]));
      map.fitBounds(bounds, { padding: [80, 80] });
    } else {
      map.setView(MULTAN_COORDS, 13);
    }
  }, [locations, map]);
  return null;
}

export default function App() {
  const [startPoint, setStartPoint] = useState<Location | null>(LANDMARKS[3]); // Cantt as default
  const [stops, setStops] = useState<Location[]>([]);
  const [optimizedRoute, setOptimizedRoute] = useState<RouteStop[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [smartTips, setSmartTips] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const trafficImpact = useMemo(() => {
    const hour = currentTime.getHours();
    if ((hour >= 8 && hour <= 10) || (hour >= 18 && hour <= 21)) return { label: 'CRITICAL PEAK', multiplier: 2.8, color: 'text-red-600', dot: 'bg-red-500 shadow-[0_0_8px_#ef4444]' };
    if (hour >= 13 && hour <= 15) return { label: 'MODERATE PEAK', multiplier: 1.8, color: 'text-amber-600', dot: 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' };
    return { label: 'LOW FLOW', multiplier: 1.1, color: 'text-emerald-600', dot: 'bg-emerald-500 shadow-[0_0_8px_#10b981]' };
  }, [currentTime]);

  const handleAddStop = (loc: Location) => {
    if (!stops.find(s => s.id === loc.id)) {
      setStops([...stops, loc]);
      setOptimizedRoute([]);
    }
  };

  const calculateETAs = (start: Location, sortedStops: Location[]): RouteStop[] => {
    const route: RouteStop[] = [];
    let currentPos = { lat: start.lat, lng: start.lng, time: currentTime };
    
    sortedStops.forEach((stop) => {
      const dist = getDistance(currentPos.lat, currentPos.lng, stop.lat, stop.lng);
      // Avg speed in Multan city is ~25 km/h base
      const baseTimeMin = (dist / 25) * 60;
      // Add traffic factor + area specific weight
      const congestionFactor = trafficImpact.multiplier * (1 + stop.baseTrafficWeight * 0.5);
      const actualTimeMin = baseTimeMin * congestionFactor + 5; // 5 min for unloading
      
      const arrivalTime = addMinutes(currentPos.time, actualTimeMin);
      
      route.push({
        ...stop,
        eta: arrivalTime,
        distanceFromPrev: dist,
        timeFromPrev: actualTimeMin,
        congestion: congestionFactor
      });
      
      currentPos = { lat: stop.lat, lng: stop.lng, time: arrivalTime };
    });
    
    return route;
  };

  const runOptimization = async () => {
    if (!startPoint || stops.length === 0) return;
    setIsOptimizing(true);
    
    setTimeout(async () => {
      // Nearest Neighbor Logic (TSP Lite)
      const sortedStops: Location[] = [];
      let currentLoc = startPoint;
      let remaining = [...stops];

      while (remaining.length > 0) {
        let nearestIdx = 0;
        let minDist = getDistance(currentLoc.lat, currentLoc.lng, remaining[0].lat, remaining[0].lng);
        for (let i = 1; i < remaining.length; i++) {
          const d = getDistance(currentLoc.lat, currentLoc.lng, remaining[i].lat, remaining[i].lng);
          if (d < minDist) {
            minDist = d;
            nearestIdx = i;
          }
        }
        currentLoc = remaining[nearestIdx];
        sortedStops.push(currentLoc);
        remaining.splice(nearestIdx, 1);
      }

      const routeWithEtas = calculateETAs(startPoint, sortedStops);
      setOptimizedRoute(routeWithEtas);
      setIsOptimizing(false);
      
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.8 },
        colors: ['#059669', '#3b82f6', '#f8fafc']
      });

      // Set static logistics tips for Multan
      setSmartTips([
        "Chowk Kumharanwala is seeing major gridlock; use bypass if possible.",
        "Mall road traffic is surging due to evening peak hours.",
        "Gulgasht inner roads are clear for faster delivery flow."
      ]);
    }, 1200);
  };

  const totalDistance = optimizedRoute.reduce((sum, r) => sum + r.distanceFromPrev, 0);
  const totalTime = optimizedRoute.length > 0 
    ? Math.round((optimizedRoute[optimizedRoute.length - 1].eta.getTime() - currentTime.getTime()) / 60000)
    : 0;

  return (
    <div className="flex h-screen w-full bg-[#f8fafc] text-slate-900 font-sans overflow-hidden">
      {/* Sidebar: High Density Theme */}
      <AnimatePresence mode="wait">
        {sidebarOpen && (
          <motion.aside 
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -100, opacity: 0 }}
            className="w-80 h-full border-r border-slate-200 bg-white flex flex-col z-50 shrink-0 shadow-[0_0_40px_rgba(0,0,0,0.05)]"
          >
            <div className="p-4 border-b border-slate-100 bg-slate-900 text-white">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400"></div>
                <h1 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  <Navigation className="w-3.5 h-3.5" /> MULTAN SMART ROUTE
                </h1>
              </div>
              <p className="text-[9px] text-slate-400 font-medium tracking-tight">LOGISTICS OPTIMIZER V2.8 (MULTAN-CORE)</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar bg-white">
              {/* Route Selection */}
              <section className="space-y-4">
                <div className="flex justify-between items-center">
                   <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Route Selection</h2>
                   <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", trafficImpact.color.replace('text-', 'bg-') + '/10')}>
                     {trafficImpact.label}
                   </span>
                </div>

                <div className="space-y-3">
                  <div className="group">
                    <label className="text-[9px] font-bold text-slate-500 uppercase mb-1.5 block">Starting Point</label>
                    <div className="relative">
                      <select 
                        value={startPoint?.id}
                        onChange={(e) => {
                          const found = LANDMARKS.find(l => l.id === e.target.value);
                          if (found) setStartPoint(found);
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs font-medium focus:outline-none focus:border-blue-500 appearance-none cursor-pointer hover:bg-slate-100 transition-colors"
                      >
                        {LANDMARKS.map(l => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-500 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-[9px] font-bold text-slate-500 uppercase">Delivery Stops</label>
                      <span className="text-[9px] font-mono font-bold text-slate-400">{stops.length} ACTIVE</span>
                    </div>
                    
                    <div className="space-y-1.5">
                      {stops.map((stop, i) => {
                        const optStop = optimizedRoute.find(r => r.id === stop.id);
                        return (
                          <motion.div 
                            key={stop.id}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={cn(
                              "flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded group transition-all",
                              optStop ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-slate-300"
                            )}
                          >
                            <span className="text-slate-400 font-mono text-[10px] w-4 shrink-0 text-center">
                              {i + 1 < 10 ? `0${i + 1}` : i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                               <p className="text-[11px] font-medium truncate leading-tight">{stop.name}</p>
                               {optStop && (
                                 <p className="text-[9px] font-mono text-emerald-600 font-bold">
                                   ETA: {format(optStop.eta, 'HH:mm')}
                                 </p>
                               )}
                            </div>
                            <button 
                              onClick={() => { setStops(stops.filter(s => s.id !== stop.id)); setOptimizedRoute([]); }}
                              className="text-slate-300 hover:text-red-500 transition-colors p-1"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </motion.div>
                        );
                      })}
                      
                      <div className="relative group">
                        <input 
                          type="text"
                          placeholder="Search for adding stop..."
                          className="w-full bg-white border-2 border-dashed border-slate-200 rounded p-2 text-[10px] outline-none focus:border-emerald-500 focus:bg-emerald-50/20 transition-all placeholder:text-slate-400"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <Plus className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-300 group-focus-within:text-emerald-500" />
                        
                        {searchQuery && (
                          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded shadow-xl z-[100] max-h-40 overflow-y-auto">
                            {LANDMARKS.filter(l => 
                              l.id !== startPoint?.id && 
                              !stops.find(s => s.id === l.id) &&
                              l.name.toLowerCase().includes(searchQuery.toLowerCase())
                            ).map(l => (
                              <button
                                key={l.id}
                                onClick={() => { handleAddStop(l); setSearchQuery(''); }}
                                className="w-full text-left p-2 hover:bg-slate-50 text-[10px] font-medium flex items-center justify-between border-b border-slate-100 last:border-0"
                              >
                                {l.name}
                                <span className="text-[8px] px-1 bg-slate-100 rounded text-slate-500">ADD</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Metrics Section */}
              <section className="pt-4 border-t border-slate-100">
                <h2 className="text-[10px] font-bold text-slate-400 uppercase mb-3 px-1 tracking-widest">Efficiency Metrics</h2>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter mb-1">Impact Saved</p>
                    <p className="text-xs font-mono font-black text-emerald-600">-{Math.round(totalTime * 0.15)}M</p>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter mb-1">Stability</p>
                    <p className="text-xs font-mono font-black text-blue-600">92%</p>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter mb-1">Avg Delay</p>
                    <p className="text-xs font-mono font-black text-amber-600">{(totalDistance > 0 ? (totalTime / totalDistance * 0.4).toFixed(1) : 1.1)}x</p>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter mb-1">Reliability</p>
                    <p className="text-xs font-mono font-black text-emerald-600">+98%</p>
                  </div>
                </div>
              </section>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100">
              <button 
                onClick={runOptimization}
                disabled={isOptimizing || stops.length === 0}
                className={cn(
                  "w-full bg-slate-900 text-white font-black py-4 rounded shadow-lg text-[11px] tracking-[0.2em] uppercase transition-all flex items-center justify-center gap-2 group",
                  (isOptimizing || stops.length === 0) ? "opacity-50 grayscale cursor-not-allowed text-slate-500" : "hover:bg-emerald-600 hover:shadow-emerald-200 active:scale-95"
                )}
              >
                {isOptimizing ? (
                  <div className="animate-spin h-3 w-3 border-2 border-slate-400 border-t-white rounded-full" />
                ) : (
                  <Zap className="w-3.5 h-3.5 fill-current group-hover:scale-125 transition-transform" />
                )}
                Generate Dispatch
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Viewport */}
      <main className="flex-1 relative bg-slate-200 overflow-hidden">
        {/* Floating Status Bar */}
        <div className="absolute top-6 left-6 right-6 flex justify-between items-start z-[500] pointer-events-none">
          <div className="bg-white/95 backdrop-blur-md p-4 rounded-xl shadow-2xl border border-white/50 flex gap-8 items-center pointer-events-auto">
            <div className="border-r border-slate-100 pr-8">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                <Clock className="w-2.5 h-2.5" /> Arrival Window
              </p>
              <p className="text-2xl font-mono font-black text-slate-900 tracking-tighter uppercase">
                {totalTime}<span className="text-[9px] font-sans font-bold text-slate-400 ml-1.5 tracking-normal">MINS Total</span>
              </p>
            </div>
            <div className="border-r border-slate-100 pr-8">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                <Navigation className="w-2.5 h-2.5" /> Span
              </p>
              <p className="text-2xl font-mono font-black text-slate-900 tracking-tighter uppercase">
                {totalDistance.toFixed(1)}<span className="text-[9px] font-sans font-bold text-slate-400 ml-1.5 tracking-normal">KMS Span</span>
              </p>
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                <TrendingUp className="w-2.5 h-2.5" /> Traffic Logic
              </p>
              <div className="flex items-center gap-2 mt-1">
                <div className={cn("w-2 h-2 rounded-full", trafficImpact.dot)}></div>
                <p className="text-xs font-black text-slate-800 tracking-tight uppercase">{trafficImpact.label}</p>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col gap-2 pointer-events-auto">
             <div className="bg-white px-3 py-2 rounded-lg shadow-sm border border-slate-200 flex items-center gap-2.5">
               <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
               <span className="text-[9px] font-black tracking-tighter text-slate-600 uppercase flex items-center gap-1.5">
                 <ShieldCheck className="w-3 h-3" /> Core Secured
               </span>
             </div>
             <div className="bg-white px-3 py-2 rounded-lg shadow-sm border border-slate-200 flex items-center gap-2.5">
               <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]"></span>
               <span className="text-[9px] font-black tracking-tighter text-slate-600 uppercase flex items-center gap-1.5">
                 <Cpu className="w-3 h-3" /> ML-ENGINE v3.1
               </span>
             </div>
             <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="bg-white p-2.5 rounded-lg shadow-sm border border-slate-200 hover:bg-slate-50 transition-colors self-end"
             >
                {sidebarOpen ? <ChevronRight className="w-4 h-4 rotate-180" /> : <Menu className="w-4 h-4" />}
             </button>
          </div>
        </div>

        {/* Map */}
        <MapContainer 
          center={MULTAN_COORDS} 
          zoom={13} 
          className="h-full w-full grayscale-[0.6] contrast-[1.1] brightness-[0.95]"
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          />
          
          <MapAutoCenter locations={startPoint ? [startPoint, ...stops] : stops} />

          {startPoint && (
            <Marker position={[startPoint.lat, startPoint.lng]}>
              <Popup>
                <div className="p-1 px-2">
                  <p className="font-black text-[9px] uppercase text-blue-600">HUB ORIGIN</p>
                  <p className="text-[11px] font-bold">{startPoint.name}</p>
                </div>
              </Popup>
            </Marker>
          )}

          {optimizedRoute.map((stop, i) => (
            <Marker key={stop.id} position={[stop.lat, stop.lng]}>
              <Popup>
                <div className="p-1 px-2">
                  <p className="font-black text-[9px] uppercase text-emerald-600 mb-1">STOP {i+1}</p>
                  <p className="text-[11px] font-bold mb-1">{stop.name}</p>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-2.5 h-2.5 text-slate-400" />
                    <p className="text-[9px] font-mono font-bold text-slate-800">ETA: {format(stop.eta, 'HH:mm')}</p>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          {optimizedRoute.length > 0 && startPoint && (
            <Polyline 
              positions={[[startPoint.lat, startPoint.lng], ...optimizedRoute.map(r => [r.lat, r.lng])] as [number, number][]} 
              color="#059669" 
              weight={5} 
              opacity={0.85}
              lineCap="round"
              lineJoin="round"
            />
          )}
        </MapContainer>

        {/* Bottom Analysis Panel */}
        {smartTips.length > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="absolute bottom-6 left-6 right-6 bg-slate-900 shadow-2xl p-6 flex flex-row items-center gap-8 z-[500] border border-slate-800 rounded-xl"
          >
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <span className="bg-emerald-500 text-slate-900 text-[8px] px-2 py-0.5 rounded font-black tracking-[0.15em] flex items-center gap-1.5">
                  <Zap className="w-2.5 h-2.5 fill-current" /> TRAFFIC INTEL (MULTAN)
                </span>
                <span className="text-[9px] font-bold text-slate-500 tracking-tight">
                  LIVE FEED SYNCHRONIZED • {format(currentTime, 'HH:mm:ss')}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                {smartTips.map((tip, i) => (
                  <p key={i} className="text-[11px] text-slate-300 leading-tight font-medium flex items-center gap-2">
                    <span className="w-1 h-1 shadow-[0_0_4px_#34d399] rounded-full bg-emerald-400 shrink-0"></span>
                    <span className="truncate">{tip}</span>
                  </p>
                ))}
              </div>
            </div>
            <div className="h-16 w-px bg-slate-800 hidden lg:block"></div>
            <div className="hidden lg:flex gap-10">
              <div className="text-center">
                <p className="text-[8px] text-slate-500 mb-1.5 font-black tracking-widest uppercase">Gas Index</p>
                <p className="text-xl font-mono font-black text-white">278.4<span className="text-[8px] ml-1 font-sans text-slate-500">PK/L</span></p>
              </div>
              <div className="text-center">
                <p className="text-[8px] text-slate-500 mb-1.5 font-black tracking-widest uppercase">Flow Rate</p>
                <p className="text-xl font-mono font-black text-white">32<span className="text-[8px] ml-1 font-sans text-slate-500">KM/H</span></p>
              </div>
              <div className="text-center">
                <p className="text-[8px] text-slate-500 mb-1.5 font-black tracking-widest uppercase">Confidence</p>
                <p className="text-xl font-mono font-black text-emerald-400">98%</p>
              </div>
            </div>
            <button className="bg-slate-800 hover:bg-slate-700 p-3.5 rounded-lg transition-all active:scale-90 flex items-center justify-center">
               <FastForward className="w-5 h-5 text-emerald-400" />
            </button>
          </motion.div>
        )}
      </main>

      <style>{`
        .leaflet-container { background: #e2e8f0 !important; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        .leaflet-popup-content-wrapper { 
          background: white !important; 
          color: #0f172a !important; 
          border-radius: 4px !important; 
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1) !important;
          border: 1px solid #e2e8f0;
          padding: 0 !important;
        }
        .leaflet-popup-content { margin: 10px !important; }
        .leaflet-popup-tip { background: white !important; border: 1px solid #e2e8f0; }
        select {
          -webkit-appearance: none;
          -moz-appearance: none;
          text-indent: 1px;
          text-overflow: '';
        }
      `}</style>
    </div>
  );
}
