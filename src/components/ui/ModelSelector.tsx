import React, { useState, useEffect } from 'react';
import { useAppearance } from '../../context/AppearanceContext';

interface ModelConfig {
  provider: "gemini" | "k2think";
  model: string;
}

interface ModelSelectorProps {
  onModelChange?: (provider: "gemini" | "k2think", model: string) => void;
  onChatOpen?: () => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ onModelChange, onChatOpen }) => {
  const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'testing' | 'success' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<"gemini" | "k2think">("gemini");
  const [selectedGeminiModel, setSelectedGeminiModel] = useState<string>("models/gemini-2.5-flash");
  const [selectedK2ThinkModel, setSelectedK2ThinkModel] = useState<string>("MBZUAI-IFM/K2-Think-v2");
  const [k2ThinkApiKey, setK2ThinkApiKey] = useState('');
  const { appearance } = useAppearance();
  const isBlack = appearance === "black";

  const containerClasses = `p-4 rounded-lg border space-y-4 backdrop-blur-md transition-colors duration-200 ${isBlack ? "bg-black/70 border-white/20 text-gray-100" : "bg-white/20 border-white/30 text-gray-800"
    }`;

  const loadingContainerClasses = `p-4 rounded-lg border backdrop-blur-md ${isBlack ? "bg-black/60 border-white/15" : "bg-white/20 border-white/30"
    }`;

  const headingClass = `text-sm font-semibold ${isBlack ? "text-gray-100" : "text-gray-800"}`;
  const labelClass = `text-xs font-medium ${isBlack ? "text-gray-200" : "text-gray-700"}`;
  const currentBadgeClass = `text-xs rounded px-2 py-2 border ${isBlack ? "text-gray-200 bg-white/5 border-white/10" : "text-gray-600 bg-white/40 border-white/50"
    }`;
  const infoTextClass = `text-xs space-y-1 ${isBlack ? "text-gray-300" : "text-gray-600"}`;

  const inputBaseClass = `w-full px-3 py-2 text-xs rounded border focus:outline-none ${isBlack
    ? "bg-white/10 border-white/20 text-gray-100 placeholder-gray-400"
    : "bg-white/40 border-white/60 text-gray-800 placeholder-gray-500"
    }`;

  const inactiveProviderClass = isBlack
    ? "bg-white/10 text-gray-200 hover:bg-white/20 border border-white/10"
    : "bg-white/40 text-gray-700 hover:bg-white/60";

  useEffect(() => {
    loadCurrentConfig();
  }, []);

  const loadCurrentConfig = async () => {
    try {
      setIsLoading(true);
      const config = await window.electronAPI.getCurrentLlmConfig();
      setCurrentConfig(config);
      setSelectedProvider(config.provider);

      if (config.provider === 'k2think') {
        setSelectedK2ThinkModel(config.model);
      } else {
        setSelectedGeminiModel(config.model || "models/gemini-2.5-flash");
      }
    } catch (error) {
      console.error('Error loading current config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const testConnection = async () => {
    try {
      setConnectionStatus('testing');
      const result = await window.electronAPI.testLlmConnection();
      setConnectionStatus(result.success ? 'success' : 'error');
      if (!result.success) {
        setErrorMessage(result.error || 'Unknown error');
      }
    } catch (error) {
      setConnectionStatus('error');
      setErrorMessage(String(error));
    }
  };

  const handleProviderSwitch = async () => {
    try {
      setConnectionStatus('testing');
      let result;

      if (selectedProvider === 'k2think') {
        result = await window.electronAPI.switchToK2Think(k2ThinkApiKey || undefined, selectedK2ThinkModel);
      } else {
        result = await window.electronAPI.switchToGemini(geminiApiKey || undefined, selectedGeminiModel);
      }

      if (result.success) {
        await loadCurrentConfig();
        setConnectionStatus('success');
        onModelChange?.(
          selectedProvider,
          selectedProvider === 'k2think' ? selectedK2ThinkModel : selectedGeminiModel
        );
        // Auto-open chat window after successful model change
        setTimeout(() => {
          onChatOpen?.();
        }, 500);
      } else {
        setConnectionStatus('error');
        setErrorMessage(result.error || 'Switch failed');
      }
    } catch (error) {
      setConnectionStatus('error');
      setErrorMessage(String(error));
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'testing':
        return isBlack ? 'text-yellow-300' : 'text-yellow-600';
      case 'success':
        return isBlack ? 'text-green-300' : 'text-green-600';
      case 'error':
        return isBlack ? 'text-red-300' : 'text-red-600';
      default:
        return isBlack ? 'text-gray-300' : 'text-gray-600';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'testing': return 'Testing connection...';
      case 'success': return 'Connected successfully';
      case 'error': return `Error: ${errorMessage}`;
      default: return 'Ready';
    }
  };

  if (isLoading) {
    return (
      <div className={loadingContainerClasses}>
        <div className={`animate-pulse text-sm ${isBlack ? 'text-gray-300' : 'text-gray-600'}`}>
          Loading model configuration...
        </div>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      <div className="flex items-center justify-between">
        <h3 className={headingClass}>AI Model Selection</h3>
        <div className={`text-xs ${getStatusColor()}`}>
          {getStatusText()}
        </div>
      </div>

      {/* Current Status */}
      {currentConfig && (
        <div className={currentBadgeClass}>
          Current: {
            currentConfig.provider === 'k2think' ? '🧠' : '☁️'
          } {currentConfig.model}
        </div>
      )}

      {/* Provider Selection */}
      <div className="space-y-2">
        <label className={labelClass}>Provider</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSelectedProvider('gemini')}
            className={`px-3 py-2 rounded text-xs transition-all ${selectedProvider === 'gemini'
              ? 'bg-blue-500 text-white shadow-md'
              : inactiveProviderClass
              }`}
          >
            ☁️ Gemini
          </button>
          <button
            onClick={() => setSelectedProvider('k2think')}
            className={`px-3 py-2 rounded text-xs transition-all ${selectedProvider === 'k2think'
              ? 'bg-orange-500 text-white shadow-md'
              : inactiveProviderClass
              }`}
          >
            🧠 K2 Think
          </button>
        </div>
      </div>

      {/* Provider-specific settings */}
      {selectedProvider === 'gemini' ? (
        <div className="space-y-2">
          <label className={labelClass}>Gemini API Key (optional if already set)</label>
          <input
            type="password"
            placeholder="Enter API key to update..."
            value={geminiApiKey}
            onChange={(e) => setGeminiApiKey(e.target.value)}
            className={`${inputBaseClass} focus:ring-2 focus:ring-blue-400/60`}
          />

          <div>
            <label className={labelClass}>Gemini Model</label>
            <select
              value={selectedGeminiModel}
              onChange={(e) => setSelectedGeminiModel(e.target.value)}
              className={`${inputBaseClass} mt-1 focus:ring-2 focus:ring-blue-400/60`}
            >
              <option value="models/gemini-2.5-flash">Gemini 2.5 Flash (default)</option>
              <option value="models/gemini-3-flash">Gemini 3 Flash</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className={labelClass}>K2 Think API Key (optional if already set)</label>
          <input
            type="password"
            placeholder="Enter API key to update..."
            value={k2ThinkApiKey}
            onChange={(e) => setK2ThinkApiKey(e.target.value)}
            className={`${inputBaseClass} focus:ring-2 focus:ring-orange-400/60`}
          />

          <div>
            <label className={labelClass}>K2 Think Model</label>
            <select
              value={selectedK2ThinkModel}
              onChange={(e) => setSelectedK2ThinkModel(e.target.value)}
              className={`${inputBaseClass} mt-1 focus:ring-2 focus:ring-orange-400/60`}
            >
              <option value="MBZUAI-IFM/K2-Think-v2">K2 Think V2 (default)</option>
            </select>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={handleProviderSwitch}
          disabled={connectionStatus === 'testing'}
          className={`flex-1 px-3 py-2 text-xs rounded transition-all shadow-md text-white ${connectionStatus === 'testing'
            ? 'bg-gray-400'
            : 'bg-blue-500 hover:bg-blue-600'
            }`}
        >
          {connectionStatus === 'testing' ? 'Switching...' : 'Apply Changes'}
        </button>

        <button
          onClick={testConnection}
          disabled={connectionStatus === 'testing'}
          className={`px-3 py-2 text-xs rounded transition-all shadow-md text-white ${connectionStatus === 'testing'
            ? 'bg-gray-400'
            : isBlack
              ? 'bg-gray-600 hover:bg-gray-500'
              : 'bg-gray-500 hover:bg-gray-600'
            }`}
        >
          Test
        </button>
      </div>

      {/* Help text */}
      <div className={infoTextClass}>
        <div>💡 <strong>Gemini:</strong> Fast, cloud-based, requires API key</div>
        <div>💡 <strong>K2 Think:</strong> High-reasoning AI, requires API key</div>
      </div>
    </div>
  );
};

export default ModelSelector;