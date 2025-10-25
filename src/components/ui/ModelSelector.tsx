import React, { useState, useEffect } from 'react';
import { useAppearance } from '../../context/AppearanceContext';

interface ModelConfig {
  provider: "ollama" | "gemini" | "openrouter";
  model: string;
  isOllama: boolean;
}

interface ModelSelectorProps {
  onModelChange?: (provider: "ollama" | "gemini" | "openrouter", model: string) => void;
  onChatOpen?: () => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ onModelChange, onChatOpen }) => {
  const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);
  const [availableOllamaModels, setAvailableOllamaModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'testing' | 'success' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<"ollama" | "gemini" | "openrouter">("gemini");
  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string>("");
  const [selectedGeminiModel, setSelectedGeminiModel] = useState<string>("models/gemini-2.5-flash");
  const [selectedOpenRouterModel, setSelectedOpenRouterModel] = useState<string>("google/gemini-2.5-flash");
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState<string>("http://localhost:11434");
  const { appearance } = useAppearance();
  const isBlack = appearance === "black";

  const containerClasses = `p-4 rounded-lg border space-y-4 backdrop-blur-md transition-colors duration-200 ${
    isBlack ? "bg-black/70 border-white/20 text-gray-100" : "bg-white/20 border-white/30 text-gray-800"
  }`;

  const loadingContainerClasses = `p-4 rounded-lg border backdrop-blur-md ${
    isBlack ? "bg-black/60 border-white/15" : "bg-white/20 border-white/30"
  }`;

  const headingClass = `text-sm font-semibold ${isBlack ? "text-gray-100" : "text-gray-800"}`;
  const labelClass = `text-xs font-medium ${isBlack ? "text-gray-200" : "text-gray-700"}`;
  const currentBadgeClass = `text-xs rounded px-2 py-2 border ${
    isBlack ? "text-gray-200 bg-white/5 border-white/10" : "text-gray-600 bg-white/40 border-white/50"
  }`;
  const infoTextClass = `text-xs space-y-1 ${isBlack ? "text-gray-300" : "text-gray-600"}`;
  const helperCardClass = `text-xs rounded px-3 py-2 ${
    isBlack ? "text-gray-300 bg-white/10 border border-white/15" : "text-gray-600 bg-yellow-100/60"
  }`;

  const inputBaseClass = `w-full px-3 py-2 text-xs rounded border focus:outline-none ${
    isBlack
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
      
      if (config.provider === 'ollama') {
        setSelectedOllamaModel(config.model);
        await loadOllamaModels();
      } else if (config.provider === 'openrouter') {
        setSelectedOpenRouterModel(config.model);
      } else {
        setSelectedGeminiModel(config.model || "models/gemini-2.5-flash");
      }
    } catch (error) {
      console.error('Error loading current config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadOllamaModels = async () => {
    try {
      const models = await window.electronAPI.getAvailableOllamaModels();
      setAvailableOllamaModels(models);
      
      // Auto-select first model if none selected
      if (models.length > 0 && !selectedOllamaModel) {
        setSelectedOllamaModel(models[0]);
      }
    } catch (error) {
      console.error('Error loading Ollama models:', error);
      setAvailableOllamaModels([]);
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
      
      if (selectedProvider === 'ollama') {
        result = await window.electronAPI.switchToOllama(selectedOllamaModel, ollamaUrl);
      } else if (selectedProvider === 'openrouter') {
        result = await window.electronAPI.switchToOpenRouter(openRouterApiKey, selectedOpenRouterModel);
      } else {
        result = await window.electronAPI.switchToGemini(geminiApiKey || undefined, selectedGeminiModel);
      }

      if (result.success) {
        await loadCurrentConfig();
        setConnectionStatus('success');
        onModelChange?.(
          selectedProvider,
          selectedProvider === 'ollama' ? selectedOllamaModel : selectedProvider === 'openrouter' ? selectedOpenRouterModel : selectedGeminiModel
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
          Current: {currentConfig.provider === 'ollama' ? '🏠' : currentConfig.provider === 'openrouter' ? '🌐' : '☁️'} {currentConfig.model}
        </div>
      )}

      {/* Provider Selection */}
      <div className="space-y-2">
        <label className={labelClass}>Provider</label>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setSelectedProvider('gemini')}
            className={`px-3 py-2 rounded text-xs transition-all ${
              selectedProvider === 'gemini'
                ? 'bg-blue-500 text-white shadow-md'
                : inactiveProviderClass
            }`}
          >
            ☁️ Gemini
          </button>
          <button
            onClick={() => setSelectedProvider('openrouter')}
            className={`px-3 py-2 rounded text-xs transition-all ${
              selectedProvider === 'openrouter'
                ? 'bg-purple-500 text-white shadow-md'
                : inactiveProviderClass
            }`}
          >
            🌐 OpenRouter
          </button>
          <button
            onClick={() => setSelectedProvider('ollama')}
            className={`px-3 py-2 rounded text-xs transition-all ${
              selectedProvider === 'ollama'
                ? 'bg-green-500 text-white shadow-md'
                : inactiveProviderClass
            }`}
          >
            🏠 Ollama
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
              <option value="models/gemini-2.5-pro">Gemini 2.5 Pro</option>
            </select>
          </div>
        </div>
      ) : selectedProvider === 'openrouter' ? (
        <div className="space-y-2">
          <label className={labelClass}>OpenRouter API Key</label>
          <input
            type="password"
            placeholder="Enter your OpenRouter API key..."
            value={openRouterApiKey}
            onChange={(e) => setOpenRouterApiKey(e.target.value)}
            className={`${inputBaseClass} focus:ring-2 focus:ring-purple-400/60`}
          />

          <div>
            <label className={labelClass}>Model</label>
            <select
              value={selectedOpenRouterModel}
              onChange={(e) => setSelectedOpenRouterModel(e.target.value)}
              className={`${inputBaseClass} mt-1 focus:ring-2 focus:ring-purple-400/60`}
            >
              <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="google/gemini-2.5-pro">Gemini 2.5 Pro</option>
              <option value="moonshotai/kimi-k2:free">Moonshot AI Kimi K2 (Free)</option>
              <option value="anthropic/claude-3-haiku:beta">Claude 3 Haiku (Beta)</option>
              <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <label className={labelClass}>Ollama URL</label>
            <input
              type="url"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              className={`${inputBaseClass} focus:ring-2 focus:ring-green-400/60`}
            />
          </div>
          
          <div>
            <div className="flex items-center gap-2">
              <label className={labelClass}>Model</label>
              <button
                onClick={loadOllamaModels}
                className={`px-2 py-1 text-xs rounded transition-all ${
                  isBlack ? 'bg-white/10 text-gray-200 hover:bg-white/20 border border-white/10' : 'bg-white/60 hover:bg-white/80'
                }`}
                title="Refresh models"
              >
                🔄
              </button>
            </div>
            
            {availableOllamaModels.length > 0 ? (
              <select
                value={selectedOllamaModel}
                onChange={(e) => setSelectedOllamaModel(e.target.value)}
                className={`${inputBaseClass} focus:ring-2 focus:ring-green-400/60`}
              >
                {availableOllamaModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <div className={helperCardClass}>
                No Ollama models found. Make sure Ollama is running and models are installed.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={handleProviderSwitch}
          disabled={connectionStatus === 'testing'}
          className={`flex-1 px-3 py-2 text-xs rounded transition-all shadow-md text-white ${
            connectionStatus === 'testing'
              ? 'bg-gray-400'
              : 'bg-blue-500 hover:bg-blue-600'
          }`}
        >
          {connectionStatus === 'testing' ? 'Switching...' : 'Apply Changes'}
        </button>
        
        <button
          onClick={testConnection}
          disabled={connectionStatus === 'testing'}
          className={`px-3 py-2 text-xs rounded transition-all shadow-md text-white ${
            connectionStatus === 'testing'
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
        <div>💡 <strong>OpenRouter:</strong> Access to multiple AI models, requires API key</div>
        <div>💡 <strong>Ollama:</strong> Private, local, requires Ollama installation</div>
      </div>
    </div>
  );
};

export default ModelSelector;