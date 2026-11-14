/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import { FilterState } from '../types';
import { Search, Sparkles, ChevronDown, Mic, LayoutGrid, GalleryHorizontalEnd, Sun, Moon, FileText, Star, Download, Loader2, Cpu } from 'lucide-react';
import { TRANSLATIONS, Language } from '../translations';

interface FilterBarProps {
  filters: FilterState;
  onFilterChange: (newFilters: FilterState) => void;
  uniqueGenders: string[];
  uniquePitches: string[];
  onOpenAiCasting: () => void;
  onOpenTextStudio: () => void;
  onOpenOpenAi: () => void;
  viewMode: 'carousel' | 'grid';
  onViewModeChange: (mode: 'carousel' | 'grid') => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  favoritesCount: number;
  onDownloadZip: () => void;
  isDownloadingZip: boolean;
  zipProgress: { current: number; total: number };
  lang: Language;
  onLangChange: (lang: Language) => void;
}

const FilterBar: React.FC<FilterBarProps> = ({ 
  filters, 
  onFilterChange, 
  uniqueGenders, 
  uniquePitches,
  onOpenAiCasting,
  onOpenTextStudio,
  onOpenOpenAi,
  viewMode,
  onViewModeChange,
  isDarkMode,
  toggleTheme,
  favoritesCount,
  onDownloadZip,
  isDownloadingZip,
  zipProgress,
  lang,
  onLangChange
}) => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
  
  const handleGenderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({ ...filters, gender: e.target.value });
  };

  const handlePitchChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({ ...filters, pitch: e.target.value });
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ ...filters, search: e.target.value });
  };

  return (
    <div className="relative z-50 w-full bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border-b border-zinc-200 dark:border-zinc-800 transition-colors duration-300">
        <div className="max-w-[1800px] mx-auto px-3 sm:px-6 lg:px-8 h-auto sm:h-16 py-1.5 sm:py-0">
            <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-1 sm:gap-4 sm:h-full">
                
                {/* Left: Brand + AI Casting Button + Text Studio + OpenAI.
                    shrinkable + internal scroll: it can never overlap the right group */}
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-x-auto scrollbar-hide py-1">
                    <div className="flex items-center gap-2 group select-none">
                        <div className="w-9 h-9 bg-zinc-900 dark:bg-zinc-100 rounded-xl flex items-center justify-center shadow-lg shadow-zinc-900/10 shrink-0">
                            <Mic size={18} className="text-white dark:text-zinc-900" />
                        </div>
                        <h1 className="hidden lg:block text-lg font-bold tracking-tight text-zinc-900 dark:text-white font-display whitespace-nowrap">
                            {t.appTitle}
                        </h1>
                    </div>

                    <button 
                        onClick={onOpenAiCasting}
                        className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-2 min-h-10 bg-zinc-900 dark:bg-indigo-600 hover:bg-zinc-800 dark:hover:bg-indigo-500 text-white rounded-full text-xs sm:text-sm font-medium shadow-md transition-all hover:scale-105 active:scale-95 group shrink-0"
                    >
                        <Sparkles size={14} className="text-indigo-300 dark:text-indigo-100 group-hover:text-indigo-200 transition-colors" />
                        <span className="tracking-wide hidden sm:inline">{t.aiCasting}</span>
                        <span className="tracking-wide sm:hidden">{t.aiCastingMobile}</span>
                    </button>

                    <button 
                        onClick={onOpenTextStudio}
                        className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-2 min-h-10 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 rounded-full text-xs sm:text-sm font-medium shadow-sm transition-all hover:scale-105 active:scale-95 group shrink-0"
                        title={t.textStudio}
                    >
                        <FileText size={14} className="text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors" />
                        <span className="tracking-wide hidden sm:inline">{t.textStudio}</span>
                        <span className="tracking-wide sm:hidden">{t.textStudioMobile}</span>
                    </button>

                    <button 
                        onClick={onOpenOpenAi}
                        className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-2 min-h-10 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50 rounded-full text-xs sm:text-sm font-medium shadow-sm transition-all hover:scale-105 active:scale-95 group shrink-0"
                        title="Custom OpenAI TTS & STT API"
                    >
                        <Cpu size={14} className="text-emerald-600 dark:text-emerald-400" />
                        <span className="tracking-wide hidden sm:inline">OpenAI API</span>
                        <span className="tracking-wide sm:hidden">API</span>
                    </button>
                </div>

                {/* Right: Search, Filters & Actions. Content-sized (never grows past
                    its content, so justify can't push children out of the box) and
                    scrollable; wraps to its own full-width row on phones. */}
                <div className="flex items-center gap-2 justify-start min-w-0 w-full sm:w-auto overflow-x-auto scrollbar-hide py-1">
                    
                    {/* Search Input */}
                    <div className="relative group w-full min-w-[110px] max-w-[120px] sm:max-w-[200px] transition-all">
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-zinc-400 dark:text-zinc-500">
                            <Search size={14} />
                        </div>
                        <input
                            type="text"
                            placeholder={t.searchPlaceholder}
                            value={filters.search}
                            onChange={handleSearchChange}
                            className="block w-full pl-8 pr-2.5 py-2.5 sm:py-1.5 bg-zinc-100 dark:bg-zinc-800 border-transparent focus:bg-white dark:focus:bg-zinc-900 border focus:border-indigo-200 dark:focus:border-indigo-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/30 transition-all"
                        />
                    </div>

                    {/* Desktop Filter Dropdowns */}
                    <div className="hidden 2xl:flex gap-2 shrink-0">
                         <div className="relative group">
                            <select
                                value={filters.gender}
                                onChange={handleGenderChange}
                                className="appearance-none bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 py-1.5 pl-3 pr-8 rounded-lg text-xs font-medium focus:outline-none hover:bg-zinc-50 dark:hover:bg-zinc-700 cursor-pointer transition-all"
                            >
                                <option value="All">{t.allGenders}</option>
                                {uniqueGenders.map(g => <option key={g} value={g}>{g === 'Female' ? t.female : g === 'Male' ? t.male : g}</option>)}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-400">
                                <ChevronDown size={12} />
                            </div>
                        </div>

                        <div className="relative group">
                            <select
                                value={filters.pitch}
                                onChange={handlePitchChange}
                                className="appearance-none bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 py-1.5 pl-3 pr-8 rounded-lg text-xs font-medium focus:outline-none hover:bg-zinc-50 dark:hover:bg-zinc-700 cursor-pointer transition-all"
                            >
                                <option value="All">{t.allPitches}</option>
                                {uniquePitches.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-400">
                                <ChevronDown size={12} />
                            </div>
                        </div>
                    </div>

                    <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1 hidden sm:block shrink-0"></div>

                    {/* Favorites Filter Toggle */}
                    <button
                        onClick={() => onFilterChange({ ...filters, favoritesOnly: !filters.favoritesOnly })}
                        className={`flex items-center gap-1.5 px-3 py-2 sm:py-1.5 min-h-10 sm:min-h-0 rounded-lg text-xs font-medium border transition-all ${
                            filters.favoritesOnly
                                ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                        }`}
                        title={filters.favoritesOnly ? t.favorites : t.favorites}
                    >
                        <Star size={14} className={filters.favoritesOnly ? "fill-current text-white" : "text-amber-500"} />
                        <span className="hidden sm:inline">{t.favorites}</span>
                        {favoritesCount > 0 && (
                            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${filters.favoritesOnly ? 'bg-amber-600 text-white' : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'}`}>
                                {favoritesCount}
                            </span>
                        )}
                    </button>

                    {/* Batch ZIP Download Button */}
                    <button
                        onClick={onDownloadZip}
                        disabled={isDownloadingZip}
                        className={`flex items-center gap-1.5 px-3 py-2 sm:py-1.5 min-h-10 sm:min-h-0 rounded-lg text-xs font-medium border transition-all ${
                            isDownloadingZip
                                ? 'bg-indigo-400 text-white cursor-wait opacity-80'
                                : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-700 shadow-sm'
                        }`}
                        title={t.downloadZipTooltip}
                    >
                        {isDownloadingZip ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        <span className="hidden md:inline">
                            {isDownloadingZip ? `${zipProgress.current}/${zipProgress.total}` : t.downloadZip}
                        </span>
                        <span className="md:hidden">ZIP</span>
                    </button>

                    {/* Actions Group */}
                    <div className="flex gap-1.5 sm:gap-2 shrink-0">
                        {/* Language Switcher */}
                        <div className="relative group">
                            <select
                                value={lang}
                                onChange={(e) => onLangChange(e.target.value as Language)}
                                className="appearance-none bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 py-2.5 sm:py-1.5 min-h-10 sm:min-h-0 pl-2.5 pr-7 rounded-lg text-xs font-semibold focus:outline-none cursor-pointer"
                                title="Select Language / Выберите язык / Sprache wählen"
                            >
                                <option value="en">EN</option>
                                <option value="ru">RU</option>
                                <option value="de">DE</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1.5 text-zinc-400">
                                <ChevronDown size={10} />
                            </div>
                        </div>

                        {/* View Toggle */}
                        <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg border border-zinc-200 dark:border-zinc-700">
                            <button
                                onClick={() => onViewModeChange('carousel')}
                                className={`p-2.5 sm:p-1.5 min-h-9 sm:min-h-0 min-w-9 sm:min-w-0 rounded-md transition-all ${viewMode === 'carousel' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'}`}
                                title={t.carouselView}
                            >
                                <GalleryHorizontalEnd size={14} />
                            </button>
                            <button
                                onClick={() => onViewModeChange('grid')}
                                className={`p-2.5 sm:p-1.5 min-h-9 sm:min-h-0 min-w-9 sm:min-w-0 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'}`}
                                title={t.gridView}
                            >
                                <LayoutGrid size={14} />
                            </button>
                        </div>

                        {/* Theme Toggle */}
                        <button
                            onClick={toggleTheme}
                            className="p-2.5 sm:p-2 min-h-10 sm:min-h-0 min-w-10 sm:min-w-0 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
                            title={isDarkMode ? t.switchLight : t.switchDark}
                        >
                            {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
                        </button>
                    </div>

                </div>
            </div>
        </div>
        
        {/* Mobile Filters Sub-bar */}
        <div className="2xl:hidden border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
            <div className="px-4 py-2 flex gap-2 overflow-x-auto scrollbar-hide">
                 <select
                    value={filters.gender}
                    onChange={handleGenderChange}
                    className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 py-2.5 sm:py-1 min-h-10 sm:min-h-0 px-3 rounded-md text-[10px] font-bold uppercase tracking-wide"
                >
                    <option value="All">{t.allGenders}</option>
                    {uniqueGenders.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <select
                    value={filters.pitch}
                    onChange={handlePitchChange}
                    className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 py-2.5 sm:py-1 min-h-10 sm:min-h-0 px-3 rounded-md text-[10px] font-bold uppercase tracking-wide"
                >
                    <option value="All">{t.allPitches}</option>
                    {uniquePitches.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
            </div>
        </div>
    </div>
  );
};

export default FilterBar;