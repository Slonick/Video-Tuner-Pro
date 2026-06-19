export interface AudioGraph {
  source: MediaElementAudioSourceNode;
  comp: DynamicsCompressorNode;
  gain: GainNode;
  analyserIn: AnalyserNode;
  _key?: string;
}

export interface AudioLevels {
  active: boolean;
  enabled: boolean;
  translation: boolean;
  in?: number;
  out?: number;
  threshold?: number;
  knee?: number;
}
