import React, { useState } from 'react';
import { X, Scissors, Layers, Loader2 } from 'lucide-react';

interface MattingModalProps {
    imageUrl: string;
    onClose: () => void;
    onSubmit: (mattingType: 'subject' | 'split', seed: number) => void;
    isProcessing?: boolean;
}

/**
 * 抠图弹窗组件
 * 支持两种模式：主体脱离 / 主体背景分离
 */
export const MattingModal: React.FC<MattingModalProps> = ({
    imageUrl,
    onClose,
    onSubmit,
    isProcessing = false
}) => {
    const [mattingType, setMattingType] = useState<'subject' | 'split'>('subject');
    const [seed, setSeed] = useState(-1);
    const [useRandomSeed, setUseRandomSeed] = useState(true);

    const handleSubmit = () => {
        const finalSeed = useRandomSeed ? -1 : seed;
        onSubmit(mattingType, finalSeed);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-[500px] max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-500/20 rounded-lg">
                            <Scissors className="w-5 h-5 text-green-400" />
                        </div>
                        <h2 className="text-lg font-bold text-white">抠图</h2>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className="p-2 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
                    >
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* 图片预览 */}
                    <div className="aspect-video bg-black rounded-xl overflow-hidden border border-gray-800">
                        <img 
                            src={imageUrl} 
                            alt="Preview" 
                            className="w-full h-full object-contain"
                        />
                    </div>

                    {/* 模式选择 */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-gray-300">抠图模式</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setMattingType('subject')}
                                disabled={isProcessing}
                                className={`p-4 rounded-xl border-2 transition-all ${
                                    mattingType === 'subject'
                                        ? 'border-green-500 bg-green-500/10'
                                        : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                                } disabled:opacity-50`}
                            >
                                <div className="flex flex-col items-center gap-2">
                                    <Scissors className={`w-6 h-6 ${mattingType === 'subject' ? 'text-green-400' : 'text-gray-400'}`} />
                                    <span className={`font-medium ${mattingType === 'subject' ? 'text-green-400' : 'text-gray-300'}`}>
                                        主体脱离
                                    </span>
                                    <span className="text-xs text-gray-500 text-center">
                                        抠出主体，透明背景
                                    </span>
                                </div>
                            </button>
                            <button
                                onClick={() => setMattingType('split')}
                                disabled={isProcessing}
                                className={`p-4 rounded-xl border-2 transition-all ${
                                    mattingType === 'split'
                                        ? 'border-green-500 bg-green-500/10'
                                        : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                                } disabled:opacity-50`}
                            >
                                <div className="flex flex-col items-center gap-2">
                                    <Layers className={`w-6 h-6 ${mattingType === 'split' ? 'text-green-400' : 'text-gray-400'}`} />
                                    <span className={`font-medium ${mattingType === 'split' ? 'text-green-400' : 'text-gray-300'}`}>
                                        主体背景分离
                                    </span>
                                    <span className="text-xs text-gray-500 text-center">
                                        分离为主体和背景两张图
                                    </span>
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* 种子值 */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-300">种子值</label>
                            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useRandomSeed}
                                    onChange={(e) => setUseRandomSeed(e.target.checked)}
                                    disabled={isProcessing}
                                    className="rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500"
                                />
                                随机
                            </label>
                        </div>
                        {!useRandomSeed && (
                            <input
                                type="number"
                                value={seed}
                                onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                                disabled={isProcessing}
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-green-500 disabled:opacity-50"
                                placeholder="输入种子值"
                            />
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800">
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isProcessing}
                        className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                处理中...
                            </>
                        ) : (
                            <>
                                <Scissors className="w-4 h-4" />
                                开始抠图
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MattingModal;
