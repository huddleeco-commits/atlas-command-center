import React, { useRef, useState } from 'react';
import { CheckCheck, Volume2, VolumeX } from 'lucide-react';

function ChatMessage({ message, agent }) {
  const isUser = message.role === 'user';
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const playAudio = () => {
    if (message.audio && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const handleAudioEnd = () => {
    setIsPlaying(false);
  };

  return (
    <div className={`flex mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] ${isUser ? 'order-2' : 'order-1'}`}>
        {!isUser && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{agent?.icon}</span>
            <span className="text-sm font-medium text-gray-400">{agent?.name}</span>
          </div>
        )}
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? 'bg-gold text-black rounded-br-md'
              : 'bg-dark-700 text-white rounded-bl-md'
          }`}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
        <div className={`flex items-center gap-2 mt-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span className="text-xs text-gray-500">{time}</span>
          {isUser && (
            <CheckCheck className="w-4 h-4 text-blue-400" />
          )}
          {message.tokens_used > 0 && (
            <span className="text-xs text-gray-600">
              {message.tokens_used} tokens
            </span>
          )}
          {!isUser && message.audio && (
            <>
              <button 
                onClick={playAudio}
                className="ml-2 p-1 hover:bg-dark-600 rounded transition-colors"
                title={isPlaying ? "Stop" : "Play audio"}
              >
                {isPlaying ? (
                  <VolumeX className="w-4 h-4 text-gold" />
                ) : (
                  <Volume2 className="w-4 h-4 text-gray-400 hover:text-gold" />
                )}
              </button>
              <audio 
                ref={audioRef} 
                src={`data:audio/mpeg;base64,${message.audio}`}
                onEnded={handleAudioEnd}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatMessage;