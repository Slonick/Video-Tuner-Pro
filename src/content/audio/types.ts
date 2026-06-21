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
  // Set when the primary video's audio can't be captured (both audio features are dead
  // then). The reason drives a specific tooltip: "inuse" = another graph already owns
  // it (conflicting extension/player), "cors" = genuine cross-origin source, "noctx" =
  // no Web Audio. Transient reasons (loading / suspended / VOT) are not surfaced.
  blocked?: "inuse" | "cors" | "noctx";
  in?: number;
  out?: number;
  threshold?: number;
  knee?: number;
}
