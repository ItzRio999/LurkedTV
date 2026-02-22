/**
 * LanguageFilter
 * Custom language detection from provider metadata (name, category, plot, etc).
 */
(function () {
    const DEFINITIONS = [
        { code: 'en', label: 'English', patterns: [/\bENGLISH\b/i, /(^|[\s\[(\-_/])EN($|[\s\])\-_/])/i] },
        { code: 'es', label: 'Spanish', patterns: [/\bSPANISH\b/i, /\bESPANOL\b/i, /(^|[\s\[(\-_/])ES($|[\s\])\-_/])/i] },
        { code: 'fr', label: 'French', patterns: [/\bFRENCH\b/i, /\bFRANCAIS\b/i, /(^|[\s\[(\-_/])FR($|[\s\])\-_/])/i] },
        { code: 'de', label: 'German', patterns: [/\bGERMAN\b/i, /\bDEUTSCH\b/i, /(^|[\s\[(\-_/])DE($|[\s\])\-_/])/i] },
        { code: 'it', label: 'Italian', patterns: [/\bITALIAN\b/i, /\bITALIANO\b/i, /(^|[\s\[(\-_/])IT($|[\s\])\-_/])/i] },
        { code: 'pt', label: 'Portuguese', patterns: [/\bPORTUGUESE\b/i, /\bPORTUGUES\b/i, /(^|[\s\[(\-_/])PT($|[\s\])\-_/])/i] },
        { code: 'ru', label: 'Russian', patterns: [/\bRUSSIAN\b/i, /(^|[\s\[(\-_/])RU($|[\s\])\-_/])/i] },
        { code: 'tr', label: 'Turkish', patterns: [/\bTURKISH\b/i, /(^|[\s\[(\-_/])TR($|[\s\])\-_/])/i] },
        { code: 'ar', label: 'Arabic', patterns: [/\bARABIC\b/i, /(^|[\s\[(\-_/])AR($|[\s\])\-_/])/i] },
        { code: 'hi', label: 'Hindi', patterns: [/\bHINDI\b/i, /(^|[\s\[(\-_/])HI($|[\s\])\-_/])/i] },
        { code: 'ur', label: 'Urdu', patterns: [/\bURDU\b/i, /(^|[\s\[(\-_/])UR($|[\s\])\-_/])/i] },
        { code: 'fa', label: 'Persian', patterns: [/\bPERSIAN\b/i, /\bFARSI\b/i, /(^|[\s\[(\-_/])FA($|[\s\])\-_/])/i] },
        { code: 'pl', label: 'Polish', patterns: [/\bPOLISH\b/i, /(^|[\s\[(\-_/])PL($|[\s\])\-_/])/i] },
        { code: 'nl', label: 'Dutch', patterns: [/\bDUTCH\b/i, /(^|[\s\[(\-_/])NL($|[\s\])\-_/])/i] },
        { code: 'sv', label: 'Swedish', patterns: [/\bSWEDISH\b/i, /(^|[\s\[(\-_/])SV($|[\s\])\-_/])/i] },
        { code: 'no', label: 'Norwegian', patterns: [/\bNORWEGIAN\b/i, /(^|[\s\[(\-_/])NO($|[\s\])\-_/])/i] },
        { code: 'da', label: 'Danish', patterns: [/\bDANISH\b/i, /(^|[\s\[(\-_/])DA($|[\s\])\-_/])/i] },
        { code: 'fi', label: 'Finnish', patterns: [/\bFINNISH\b/i, /(^|[\s\[(\-_/])FI($|[\s\])\-_/])/i] },
        { code: 'el', label: 'Greek', patterns: [/\bGREEK\b/i, /(^|[\s\[(\-_/])EL($|[\s\])\-_/])/i] },
        { code: 'he', label: 'Hebrew', patterns: [/\bHEBREW\b/i, /(^|[\s\[(\-_/])HE($|[\s\])\-_/])/i] },
        { code: 'zh', label: 'Chinese', patterns: [/\bCHINESE\b/i, /\bMANDARIN\b/i, /\bCANTONESE\b/i, /(^|[\s\[(\-_/])ZH($|[\s\])\-_/])/i] },
        { code: 'ja', label: 'Japanese', patterns: [/\bJAPANESE\b/i, /(^|[\s\[(\-_/])JA($|[\s\])\-_/])/i] },
        { code: 'ko', label: 'Korean', patterns: [/\bKOREAN\b/i, /(^|[\s\[(\-_/])KO($|[\s\])\-_/])/i] },
        { code: 'vi', label: 'Vietnamese', patterns: [/\bVIETNAMESE\b/i, /(^|[\s\[(\-_/])VI($|[\s\])\-_/])/i] },
        { code: 'th', label: 'Thai', patterns: [/\bTHAI\b/i, /(^|[\s\[(\-_/])TH($|[\s\])\-_/])/i] },
        { code: 'id', label: 'Indonesian', patterns: [/\bINDONESIAN\b/i, /\bBAHASA\b/i, /(^|[\s\[(\-_/])ID($|[\s\])\-_/])/i] }
    ];

    const LABELS = new Map(DEFINITIONS.map(d => [d.code, d.label]));

    function combineMetadata(item, categoryName) {
        return [
            item.name,
            item.title,
            item.plot,
            item.description,
            item.genre,
            item.director,
            item.cast,
            item.country,
            categoryName
        ].filter(Boolean).join(' ');
    }

    function detectByScript(text) {
        if (/[\u3040-\u30ff]/.test(text)) return 'ja';
        if (/[\uac00-\ud7af]/.test(text)) return 'ko';
        if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
        if (/[\u0600-\u06ff]/.test(text)) return 'ar';
        if (/[\u0590-\u05ff]/.test(text)) return 'he';
        if (/[\u0900-\u097f]/.test(text)) return 'hi';
        if (/[\u0400-\u04ff]/.test(text)) return 'ru';
        return null;
    }

    function detectLanguage(item, categoryName = '') {
        const combined = combineMetadata(item, categoryName);
        if (!combined) return 'unknown';

        for (const def of DEFINITIONS) {
            if (def.patterns.some(pattern => pattern.test(combined))) {
                return def.code;
            }
        }

        return detectByScript(combined) || 'unknown';
    }

    function getLanguageLabel(code) {
        return LABELS.get(code) || 'Unknown';
    }

    window.LanguageFilter = {
        detectLanguage,
        getLanguageLabel
    };
})();

