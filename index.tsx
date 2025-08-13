import React, { useState, useMemo, Suspense, useRef, forwardRef } from "react";
import ReactDOM from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { CSG } from 'three-csg-ts';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { Wand2, SendHorizontal, Download } from "lucide-react";

const API_KEY = process.env.API_KEY;

// --- Type Definitions ---
interface Parameter {
  key: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
}

interface Hole {
  shape: 'cylinder';
  type: 'simple' | 'countersunk';
  parameters: Parameter[];
}

interface ModelData {
  shape: 'box' | 'cylinder' | 'sphere';
  name: string;
  filletRadius?: number;
  chamferDistance?: number;
  parameters: Parameter[];
  holes?: Hole[];
}

interface GeneratedModelProps {
  modelData: ModelData | null;
}

// --- AI Configuration ---
const ai = new GoogleGenAI({ apiKey: API_KEY });
const modelSchema = {
  type: Type.OBJECT,
  properties: {
    shape: {
      type: Type.STRING,
      description: "The base geometric shape. Must be one of: 'box', 'cylinder', 'sphere'.",
      enum: ['box', 'cylinder', 'sphere']
    },
    name: {
      type: Type.STRING,
      description: "A descriptive name for the object, e.g., 'Mounting Plate'."
    },
    filletRadius: {
        type: Type.NUMBER,
        description: "The radius of the fillet (rounded edge) for 'box' shapes. Omit if not requested or if chamfer is requested.",
    },
    chamferDistance: {
        type: Type.NUMBER,
        description: "The distance of the chamfer (beveled edge) for 'box' shapes. Omit if not requested or if fillet is requested.",
    },
    parameters: {
      type: Type.ARRAY,
      description: "A list of editable parameters for the shape.",
      items: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING, description: "The parameter key, e.g., 'width', 'height', 'depth', 'radius'." },
          label: { type: Type.STRING, description: "A user-friendly label, e.g., 'Plate Width'." },
          value: { type: Type.NUMBER, description: "The numerical value of the parameter." },
          unit: { type: Type.STRING, description: "The unit of measurement, e.g., 'mm'." },
          min: { type: Type.NUMBER, description: "The minimum value for a slider, based on the value." },
          max: { type: Type.NUMBER, description: "The maximum value for a slider, based on the value." },
          step: { type: Type.NUMBER, description: "The step increment for a slider." }
        },
        required: ['key', 'label', 'value', 'unit', 'min', 'max', 'step']
      }
    },
    holes: {
        type: Type.ARRAY,
        description: "A list of holes to be cut from the main shape.",
        items: {
            type: Type.OBJECT,
            properties: {
                shape: { type: Type.STRING, description: "Shape of the hole, must be 'cylinder'." },
                type: { type: Type.STRING, description: "Type of hole, e.g., 'simple', 'countersunk'. Default to 'simple' if not specified.", enum: ['simple', 'countersunk']},
                parameters: {
                    type: Type.ARRAY,
                    description: "Parameters for the hole, like radius, height, and position. A countersunk hole also needs a countersinkRadius.",
                    items: {
                      type: Type.OBJECT,
                      properties: {
                          key: { type: Type.STRING },
                          label: { type: Type.STRING },
                          value: { type: Type.NUMBER },
                          unit: { type: Type.STRING },
                          min: { type: Type.NUMBER },
                          max: { type: Type.NUMBER },
                          step: { type: Type.NUMBER },
                      }
                    }
                }
            },
        },
    }
  },
  required: ['shape', 'name', 'parameters']
};

const systemInstruction = `You are an AI CAD assistant for AetherCAD. Your primary function is to act as a stateful model modifier.

You will receive the current 3D model as a JSON object, and a user prompt describing a change. Your task is to analyze both and return a new, modified JSON object that reflects the user's request.

**Core Rules:**
1.  **Analyze the Input JSON:** This is the current state of the model. Do not start from scratch unless it's empty.
2.  **Analyze the User Prompt:** Understand the user's intent (e.g., change a dimension, add a feature, remove a feature).
3.  **Return a Modified JSON:** Output a complete, valid JSON object based on the schema, representing the new state of the model.

**Modification Scenarios:**
-   **Changing Dimensions:** If the user says "make the plate 200mm long", find the 'width' parameter in the JSON and update its 'value'. Adjust 'min' and 'max' for the slider accordingly.
-   **Adding Features:**
    -   **Holes:** If the user says "add a 10mm hole in the center", add a new object to the 'holes' array. A hole is always a 'cylinder'. Its height must be slightly larger than the object's thickness to ensure a clean cut. The position (x, y, z) should be set. 'in the center' means position {x:0, y:0, z:0}.
    -   **Countersunk Holes:** If the user asks for a "countersunk" hole (e.g., "for an M5 screw"), set the hole type to 'countersunk'. A countersunk hole needs a 'radius' for the shaft and a 'countersinkRadius' for the conical opening. Infer sensible values (e.g., for M5, radius is 2.5mm, countersinkRadius is 5mm).
    -   **Edge Treatments (Fillet/Chamfer):** If the user asks to "add a 5mm fillet", set the top-level 'filletRadius' property. If they ask for a chamfer, set 'chamferDistance'. A model cannot have both; prioritize the newest request.
-   **Removing Features:** If the user says "remove the holes", return the JSON with the 'holes' array completely removed or emptied. If they say "remove the fillet", remove the 'filletRadius' property.

**Initial Generation:**
-   If the input JSON is empty or null, generate a new model from the user's description.
-   For a 'box', map 'length' to 'width' (X-axis), 'width' to 'depth' (Z-axis), and 'thickness'/'height' to 'height' (Y-axis).
-   For 'cylinder' or 'sphere', use 'radius' and 'height'.
-   Always generate sensible min/max/step values for all sliders.

Your output must ONLY be the JSON object. Do not add any conversational text or markdown.`;


// --- 3D Components ---
const GeneratedModel = forwardRef<THREE.Mesh, GeneratedModelProps>(({ modelData }, ref) => {
  if (!modelData) return null;

  const { shape, parameters, holes, filletRadius, chamferDistance } = modelData;
  const scaleFactor = 0.05; // Scale down for better viewing

  const finalMesh = useMemo(() => {
    // 1. Create the base shape
    const baseParams: { [key: string]: number } = parameters.reduce((acc, p) => ({ ...acc, [p.key]: p.value }), {});
    let baseGeometry;

    if (shape === 'box' && (filletRadius || chamferDistance)) {
        const width = baseParams.width || 1;
        const depth = baseParams.depth || 1;
        const height = baseParams.height || 1;
        const r = Math.min(filletRadius || chamferDistance || 0, width / 2, depth / 2);
        
        const shape2d = new THREE.Shape();
        const w = width / 2 - r;
        const d = depth / 2 - r;

        if (filletRadius) { // Rounded corners
            shape2d.moveTo(-w, -d-r);
            shape2d.absarc(-w, -d, r, -Math.PI/2, -Math.PI, true);
            shape2d.lineTo(-w-r, d);
            shape2d.absarc(-w, d, r, Math.PI, Math.PI/2, true);
            shape2d.lineTo(w, d+r);
            shape2d.absarc(w, d, r, Math.PI/2, 0, true);
            shape2d.lineTo(w+r, -d);
            shape2d.absarc(w, -d, r, 0, -Math.PI/2, true);
        } else { // Chamfered corners
             shape2d.moveTo(-w, -d-r);
             shape2d.lineTo(-w-r, -d);
             shape2d.lineTo(-w-r, d);
             shape2d.lineTo(-w, d+r);
             shape2d.lineTo(w, d+r);
             shape2d.lineTo(w+r, d);
             shape2d.lineTo(w+r, -d);
             shape2d.lineTo(w, -d-r);
        }
        shape2d.closePath();

        const extrudeSettings = { depth: height, bevelEnabled: false };
        baseGeometry = new THREE.ExtrudeGeometry(shape2d, extrudeSettings);
        baseGeometry.center(); // Center the geometry

    } else {
        switch (shape) {
            case 'box':
                baseGeometry = new THREE.BoxGeometry(baseParams.width || 1, baseParams.height || 1, baseParams.depth || 1);
                break;
            case 'cylinder':
                baseGeometry = new THREE.CylinderGeometry(baseParams.radius || 1, baseParams.radius || 1, baseParams.height || 1, 32);
                break;
            case 'sphere':
                baseGeometry = new THREE.SphereGeometry(baseParams.radius || 1, 32, 32);
                break;
            default:
                baseGeometry = new THREE.BoxGeometry(1, 1, 1);
        }
    }
    
    const baseMesh = new THREE.Mesh(baseGeometry);
    baseMesh.updateMatrix();
    let baseBrush = CSG.fromMesh(baseMesh);

    // 2. Subtract holes if they exist
    if (holes && holes.length > 0) {
      holes.forEach(hole => {
        const holeParams: { [key: string]: number } = hole.parameters.reduce((acc, p) => ({ ...acc, [p.key]: p.value }), {});
        const radius = holeParams.radius ?? 0.5;
        const height = holeParams.height ?? 1;

        let holeBrush;
        if (hole.type === 'countersunk') {
            const countersinkRadius = holeParams.countersinkRadius ?? radius * 2;
            const countersinkHeight = countersinkRadius - radius;

            const shaftGeom = new THREE.CylinderGeometry(radius, radius, height, 32);
            const shaftMesh = new THREE.Mesh(shaftGeom);
            shaftMesh.position.set(0, 0, 0);
            shaftMesh.updateMatrix();
            let shaftBrush = CSG.fromMesh(shaftMesh);

            const coneGeom = new THREE.CylinderGeometry(countersinkRadius, radius, countersinkHeight, 32);
            const coneMesh = new THREE.Mesh(coneGeom);
            coneMesh.position.set(0, (height / 2) - (countersinkHeight / 2), 0);
            coneMesh.updateMatrix();
            const coneBrush = CSG.fromMesh(coneMesh);

            holeBrush = shaftBrush.union(coneBrush);

        } else { // Simple hole
            const holeGeometry = new THREE.CylinderGeometry(radius, radius, height, 32);
            const holeMesh = new THREE.Mesh(holeGeometry);
            holeMesh.updateMatrix();
            holeBrush = CSG.fromMesh(holeMesh);
        }
          
        const finalHoleMesh = CSG.toMesh(holeBrush, new THREE.Matrix4());
        finalHoleMesh.position.set(holeParams.x || 0, holeParams.y || 0, holeParams.z || 0);
        finalHoleMesh.updateMatrix();
        
        const finalHoleBrush = CSG.fromMesh(finalHoleMesh);
        baseBrush = baseBrush.subtract(finalHoleBrush);
      });
    }

    // 3. Convert final CSG brush back to a mesh
    const finalResult = CSG.toMesh(baseBrush, baseMesh.matrix);
    finalResult.updateMatrix();
    return finalResult;
  }, [modelData]);

  return (
    <primitive object={finalMesh} ref={ref} scale={scaleFactor} castShadow>
      <meshStandardMaterial color="#bb86fc" roughness={0.4} metalness={0.2} side={THREE.DoubleSide} />
    </primitive>
  );
});
GeneratedModel.displayName = 'GeneratedModel';

const ModelView = ({ modelData, modelRef }) => {
  return (
    <Canvas shadows camera={{ position: [15, 15, 15], fov: 50 }}>
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[10, 20, 5]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <Suspense fallback={null}>
        {modelData ? (
          <GeneratedModel modelData={modelData} ref={modelRef} />
        ) : (
          <Text
            color="white"
            anchorX="center"
            anchorY="middle"
            fontSize={1.2}
            maxWidth={15}
            textAlign="center"
          >
            AetherCAD{'\n\n'}Describe an object in the prompt bar below to begin.
          </Text>
        )}
      </Suspense>
      <OrbitControls />
      <gridHelper args={[100, 20, '#555', '#333']} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
    </Canvas>
  );
};


// --- UI Components ---
const ParametersPanel = ({ modelData, onParameterChange }: { modelData: ModelData | null, onParameterChange: (key: string, newValue: number, holeIndex?: number) => void }) => {
  if (!modelData) {
    return (
      <aside className="parameters-panel">
        <h2 style={{ color: 'var(--color-on-surface)', marginBottom: '1rem' }}>Live Parameters</h2>
        <p style={{ color: 'var(--color-on-background)', fontStyle: 'italic' }}>No model generated yet.</p>
      </aside>
    );
  }

  const renderParam = (param: Parameter, holeIndex?: number) => (
    <div key={param.key + (holeIndex !== undefined ? holeIndex : '')} style={{ marginBottom: '1.5rem' }}>
      <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, color: 'var(--color-on-surface)' }}>{param.label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={param.value}
          onChange={(e) => onParameterChange(param.key, parseFloat(e.target.value), holeIndex)}
          style={{ flexGrow: 1, accentColor: 'var(--color-primary)' }}
          aria-label={`${param.label} slider`}
        />
        <input
          type="number"
          value={param.value}
          onChange={(e) => onParameterChange(param.key, parseFloat(e.target.value) || 0, holeIndex)}
          style={{ width: '70px', padding: '6px', background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-on-background)', borderRadius: '4px' }}
          aria-label={`${param.label} value`}
        />
        <span style={{ color: 'var(--color-on-background)', fontSize: '0.9em' }}>{param.unit}</span>
      </div>
    </div>
  );

  const getParam = (key:string) => modelData.parameters.find(p => p.key === key);

  return (
    <aside className="parameters-panel">
      <h2 style={{ color: 'var(--color-on-surface)', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
        {modelData.name}
      </h2>
      
      <details open>
        <summary className="panel-summary">Base Dimensions</summary>
        <div className="panel-content">
          {modelData.parameters.map((param) => renderParam(param))}
        </div>
      </details>
      
      {(modelData.filletRadius != null || modelData.chamferDistance != null) && (
        <details open>
          <summary className="panel-summary">Edge Treatment</summary>
          <div className="panel-content">
            {modelData.filletRadius != null && renderParam({ key: 'filletRadius', label: 'Fillet Radius', value: modelData.filletRadius, unit: 'mm', min: 0, max: Math.min(getParam('width')?.value/2 || 10, getParam('depth')?.value/2 || 10), step: 0.1 })}
            {modelData.chamferDistance != null && renderParam({ key: 'chamferDistance', label: 'Chamfer Distance', value: modelData.chamferDistance, unit: 'mm', min: 0, max: Math.min(getParam('width')?.value/2 || 10, getParam('depth')?.value/2 || 10), step: 0.1 })}
          </div>
        </details>
      )}

      {modelData.holes && modelData.holes.length > 0 && (
        <details open>
            <summary className="panel-summary">Hole Features</summary>
            {modelData.holes.map((hole, holeIdx) => (
                <div key={holeIdx} className="panel-content" style={{borderTop: '1px solid var(--color-border)', paddingTop: '1rem', marginTop: '1rem' }}>
                    <h4 style={{ color: 'var(--color-primary)', marginBottom: '1rem' }}>Hole {holeIdx + 1} ({hole.type})</h4>
                    {hole.parameters.map((param) => renderParam(param, holeIdx))}
                </div>
            ))}
        </details>
      )}
    </aside>
  );
};

const PromptBar = ({ prompt, setPrompt, onSubmit, isLoading }) => {
  const handleSubmit = (e) => {
    e.preventDefault();
    if (prompt.trim() && !isLoading) {
      onSubmit(prompt);
    }
  };

  return (
    <footer className="prompt-bar-container">
      <form onSubmit={handleSubmit} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '1rem' }}>
        <Wand2 color={isLoading ? '#555' : 'var(--color-primary)'} size={24} />
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., A plate 100x100x10mm with a 5mm fillet"
          disabled={isLoading}
          aria-label="Describe the 3D model to generate"
          style={{
            flexGrow: 1,
            padding: '12px',
            fontSize: '1rem',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-on-background)',
            outline: 'none',
          }}
        />
        <button type="submit" disabled={isLoading} aria-label="Generate model" style={{ background: 'var(--color-primary)', border: 'none', color: '#121212', padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: isLoading ? 0.5 : 1 }}>
          <SendHorizontal size={20} />
        </button>
      </form>
    </footer>
  );
};

// --- Main App Component ---
const App = () => {
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const modelRef = useRef<THREE.Mesh>(null);

  const handlePromptSubmit = async (userPrompt: string) => {
    setIsLoading(true);
    setError(null);

    const fullPrompt = `
      Current Model JSON:
      ${JSON.stringify(modelData, null, 2)}
      
      User instruction: "${userPrompt}"
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: fullPrompt,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: modelSchema,
        },
      });

      const jsonText = response.text.trim();
      const parsedData = JSON.parse(jsonText);
      setModelData(parsedData);
      
    } catch (e) {
      console.error(e);
      setError("Failed to generate or modify model. Please check the prompt or try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleParameterChange = (key: string, newValue: number, holeIndex?: number) => {
    setModelData(prevData => {
        if (!prevData) return null;
        const newData = JSON.parse(JSON.stringify(prevData)); // Deep copy

        if (holeIndex !== undefined && newData.holes?.[holeIndex]) {
            const holeParam = newData.holes[holeIndex].parameters.find(p => p.key === key);
            if(holeParam) holeParam.value = newValue;
        } else {
            const baseParam = newData.parameters.find(p => p.key === key);
            if (baseParam) {
                baseParam.value = newValue;
            } else if (key === 'filletRadius' || key === 'chamferDistance') {
                newData[key] = newValue;
            }
        }
        return newData;
    });
  };
  
  const handleExport = () => {
    if (!modelRef.current || !modelData) return;
    const exporter = new STLExporter();
    const result = exporter.parse(modelRef.current, { binary: true });
    const blob = new Blob([result], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${modelData.name.replace(/\s/g, '_') || 'generated_model'}.stl`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <header className="app-header">
        <span>AetherCAD</span>
        <button className="export-button" onClick={handleExport} disabled={!modelData}>
          <Download size={16} />
          Export STL
        </button>
      </header>
      <div className="app-container">
        <main className="viewport-container">
          {isLoading && (
             <div className="loading-overlay">
                <div className="spinner"></div>
                <p>Modifying model...</p>
             </div>
          )}
          {error && <div className="loading-overlay" style={{color: '#ff8a80'}}>{error}</div>}
          <ModelView modelData={modelData} modelRef={modelRef} />
        </main>
        <ParametersPanel modelData={modelData} onParameterChange={handleParameterChange} />
      </div>
      <PromptBar
        prompt={prompt}
        setPrompt={setPrompt}
        onSubmit={handlePromptSubmit}
        isLoading={isLoading}
      />
    </>
  );
};

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);