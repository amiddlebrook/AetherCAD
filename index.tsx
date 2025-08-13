"use client";

import React, { useState, useMemo, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { Wand2, SendHorizontal } from "lucide-react";

const API_KEY = process.env.API_KEY;

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
    }
  },
  required: ['shape', 'name', 'parameters']
};

const systemInstruction = `You are an AI assistant for a web-based 3D modeling tool called AetherCAD. Your task is to convert natural language descriptions of 3D objects into a specific JSON format defined by a schema.

- The user will describe an object.
- You must identify the main primitive shape ('box', 'cylinder', or 'sphere').
- You must extract the key dimensional parameters.
- IMPORTANT: For a 'box', map user terms like 'length' to 'width' (X-axis), 'width' to 'depth' (Z-axis), and 'thickness' or 'height' to 'height' (Y-axis).
- For a 'cylinder', use 'radius' and 'height'. If the user gives a diameter, convert it to a radius.
- For a 'sphere', use 'radius'.
- Generate a user-friendly name for the object.
- For each parameter, determine a sensible min, max, and step value for a UI slider. For example, if the value is 150, a max of 300 might be appropriate. If the value is 3, a max of 20 and a step of 0.1 might be good.
- You must only output a valid JSON object matching the provided schema. Do not output any other text or explanation. Ignore any requests for complex features like holes, fillets, or assemblies for now; just model the main shape.`;

// --- 3D Components ---
const GeneratedModel = ({ modelData }) => {
  if (!modelData) return null;

  const { shape, parameters } = modelData;
  const scaleFactor = 0.05; // Scale down for better viewing

  // More efficient: create a key-value map of parameters.
  const paramsMap = useMemo(() => (
    parameters.reduce((acc, param) => {
      acc[param.key] = param.value;
      return acc;
    }, {})
  ), [parameters]);


  const geometry = useMemo(() => {
    switch (shape) {
      case 'box':
        return new THREE.BoxGeometry(paramsMap.width || 1, paramsMap.height || 1, paramsMap.depth || 1);
      case 'cylinder':
        return new THREE.CylinderGeometry(paramsMap.radius || 1, paramsMap.radius || 1, paramsMap.height || 1, 32);
      case 'sphere':
        return new THREE.SphereGeometry(paramsMap.radius || 1, 32, 32);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [shape, paramsMap]);

  return (
    <mesh geometry={geometry} scale={scaleFactor} castShadow>
      <meshStandardMaterial color="#bb86fc" roughness={0.4} metalness={0.2} />
    </mesh>
  );
};

const ModelView = ({ modelData }) => {
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
          <GeneratedModel modelData={modelData} />
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
const ParametersPanel = ({ modelData, onParameterChange }) => {
  if (!modelData) {
    return (
      <aside className="parameters-panel">
        <h2 style={{ color: 'var(--color-on-surface)', marginBottom: '1rem' }}>Live Parameters</h2>
        <p style={{ color: 'var(--color-on-background)', fontStyle: 'italic' }}>No model generated yet.</p>
      </aside>
    );
  }

  return (
    <aside className="parameters-panel">
      <h2 style={{ color: 'var(--color-on-surface)', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
        {modelData.name}
      </h2>
      {modelData.parameters.map((param, index) => (
        <div key={index} style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, color: 'var(--color-on-surface)' }}>{param.label}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="range"
              min={param.min}
              max={param.max}
              step={param.step}
              value={param.value}
              onChange={(e) => onParameterChange(index, parseFloat(e.target.value))}
              style={{ flexGrow: 1, accentColor: 'var(--color-primary)' }}
            />
            <input
              type="number"
              value={param.value}
              onChange={(e) => onParameterChange(index, parseFloat(e.target.value))}
              style={{ width: '70px', padding: '6px', background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-on-background)', borderRadius: '4px' }}
            />
            <span style={{ color: 'var(--color-on-background)', fontSize: '0.9em' }}>{param.unit}</span>
          </div>
        </div>
      ))}
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
          placeholder="e.g., Create a can 120mm tall with a 70mm diameter"
          disabled={isLoading}
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
        <button type="submit" disabled={isLoading} style={{ background: 'var(--color-primary)', border: 'none', color: '#121212', padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: isLoading ? 0.5 : 1 }}>
          <SendHorizontal size={20} />
        </button>
      </form>
    </footer>
  );
};

// --- Main App Component ---
const App = () => {
  const [modelData, setModelData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [prompt, setPrompt] = useState("");

  const handlePromptSubmit = async (userPrompt) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: modelSchema,
        },
      });

      const jsonText = response.text.trim();
      const parsedData = JSON.parse(jsonText);
      setModelData(parsedData);
      
    } catch (e) {
      console.error(e);
      setError("Failed to generate model. Please try a different prompt.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleParameterChange = (paramIndex, newValue) => {
    setModelData(prevData => {
      const newParams = [...prevData.parameters];
      newParams[paramIndex].value = newValue;
      return { ...prevData, parameters: newParams };
    });
  };

  return (
    <>
      <header style={{ padding: '0.5rem 1rem', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-on-surface)' }}>
        AetherCAD
      </header>
      <div className="app-container">
        <main className="viewport-container">
          {isLoading && (
             <div className="loading-overlay">
                <div className="spinner"></div>
                <p>Generating model...</p>
             </div>
          )}
          {error && <div className="loading-overlay" style={{color: '#ff8a80'}}>{error}</div>}
          <ModelView modelData={modelData} />
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
