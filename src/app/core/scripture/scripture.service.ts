import { Injectable, inject } from '@angular/core';
import { ChromeAiService } from '../ai/chrome-ai.service';
import { MlWorkerClient } from '../ai/ml-worker.client';

export interface ScriptureVerse {
  readonly reference: string;
  readonly kjvText: string;
  readonly themes: readonly string[];
  readonly translations: Readonly<Record<string, string>>;
}

export interface VerseSearchResult {
  readonly reference: string;
  readonly text: string;
  readonly score: number;
}

const KJV_CORPUS: readonly ScriptureVerse[] = [
  {
    reference: 'Isaiah 40:31',
    kjvText:
      'But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.',
    themes: ['strength', 'endurance', 'patience', 'run', 'weary', 'wait', 'renewal'],
    translations: {
      es: 'Pero los que esperan a Jehová tendrán nuevas fuerzas; levantarán alas como las águilas; correrán, y no se cansarán; caminarán, y no se fatigarán.',
      fr: 'Mais ceux qui se confient en l’Éternel renouvellent leur force. Ils prennent le vol comme les aigles; ils courent, et ne se lassent point; ils marchent, et ne se fatiguent point.',
      pt: 'Mas os que esperam no SENHOR renovarão as forças, subirão com asas como águias; correrão, e não se cansarão; caminharão, e não se fatigarão.',
    },
  },
  {
    reference: 'Hebrews 12:1',
    kjvText:
      'Wherefore seeing we also are compassed about with so great a cloud of witnesses, let us lay aside every weight, and let us run with patience the race that is set before us.',
    themes: ['patience', 'endurance', 'race', 'run', 'perseverance', 'focus'],
    translations: {
      es: 'Corramos con paciencia la carrera que tenemos por delante.',
      fr: 'Courons avec persévérance dans la carrière qui nous est ouverte.',
      pt: 'Corramos com paciência a carreira que nos está proposta.',
    },
  },
  {
    reference: '1 Corinthians 9:24',
    kjvText:
      'Know ye not that they which run in a race run all, but one receiveth the prize? So run, that ye may obtain.',
    themes: ['race', 'run', 'discipline', 'training', 'prize', 'focus'],
    translations: {
      es: '¿No sabéis que los que corren en el estadio, todos a la verdad corren, pero uno solo se lleva el premio? Corred de tal manera que lo obtengáis.',
      fr: 'Ne savez-vous pas que ceux qui courent dans le stade courent tous, mais qu’un seul remporte le prix? Courez de manière à le remporter.',
      pt: 'Não sabeis vós que os que correm no estádio, todos, na verdade, correm, mas um só leva o prêmio? Correi de tal maneira que o alcanceis.',
    },
  },
  {
    reference: 'Psalm 23:1-3',
    kjvText:
      'The LORD is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters. He restoreth my soul.',
    themes: ['rest', 'recovery', 'peace', 'sabbath', 'still', 'restore', 'shepherd'],
    translations: {
      es: 'Jehová es mi pastor; nada me faltará. En lugares de delicados pastos me hará descansar; junto a aguas de reposo me pastoreará.',
      fr: 'L’Éternel est mon berger: je ne manquerai de rien. Il me fait reposer dans de verts pâturages.',
      pt: 'O SENHOR é o meu pastor, nada me faltará. Deitar-me faz em verdes pastos, guia-me mansamente a águas tranquilas.',
    },
  },
  {
    reference: 'Philippians 4:13',
    kjvText: 'I can do all things through Christ which strengtheneth me.',
    themes: ['strength', 'courage', 'endurance', 'resilience'],
    translations: {
      es: 'Todo lo puedo en Cristo que me fortalece.',
      fr: 'Je puis tout par celui qui me fortifie.',
      pt: 'Posso todas as coisas em Cristo que me fortalece.',
    },
  },
];

@Injectable({ providedIn: 'root' })
export class ScriptureService {
  private readonly worker = inject(MlWorkerClient);
  private readonly chromeAi = inject(ChromeAiService);

  getDailyVerse(languageCode = 'en'): { reference: string; text: string; isTranslated: boolean } {
    const verse = KJV_CORPUS[0];
    const translated = languageCode !== 'en' ? verse.translations[languageCode] : undefined;
    return {
      reference: `${verse.reference} · ${translated ? languageCode.toUpperCase() : 'KJV'}`,
      text: translated ?? verse.kjvText,
      isTranslated: Boolean(translated),
    };
  }

  async searchSemantic(query: string, languageCode = 'en'): Promise<VerseSearchResult[]> {
    const payload = KJV_CORPUS.map((v) => ({
      reference: v.reference,
      text: v.kjvText,
      themes: v.themes,
    }));

    const workerResults = await this.worker.semanticSearch(query, payload);
    const out: VerseSearchResult[] = [];
    for (const hit of workerResults) {
      const source = KJV_CORPUS.find((v) => v.reference === hit.reference);
      const fallbackText =
        languageCode !== 'en' && source?.translations[languageCode]
          ? source.translations[languageCode]
          : hit.text;
      const text = await this.chromeAi.translateText(hit.text, languageCode, fallbackText);
      const langTag = languageCode !== 'en' && text !== hit.text ? languageCode.toUpperCase() : 'KJV';
      out.push({
        reference: `${hit.reference} · ${langTag}`,
        text,
        score: hit.score,
      });
    }
    return out;
  }
}
