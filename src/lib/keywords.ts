/**
 * Cheap pre-filter for mixed-genre sources (ticket vendors, venues). A false
 * positive costs one LLM call that returns [] (once per content hash); a false
 * negative is a missed concert, so err towards matching, but mind the stems:
 * "organ" is in "organiser", "opera" in "operation", "bach" in "bachelor".
 */
// Stems match at a word start, so Afrikaans compounds work too ("orrelkonsert", "koorfees").
const STEMS = ["orchestr", "orkes", "philharmon", "filharmon", "symphon", "simfon", "conservator", "konservator", "orrel", "koor"];
const WORDS = [
  "concerto", "concertos", "sonata", "sonatas", "quartet", "kwartet", "quintet", "trio", "chamber music", "kamermusiek",
  "choir", "choirs", "kore", "choral", "chorale", "opera", "operas", "operetta", "oratorio", "recital", "resital",
  "cantata", "kantate", "requiem", "messiah", "organ", "organist", "baroque", "barok", "classical", "klassiek",
  "piano", "pianist", "klavier", "violin", "violinist", "viool", "cello", "cellist", "soprano", "mezzo", "mezzo-soprano",
  "baritone", "countertenor", "eisteddfod", "bach", "mozart", "beethoven", "brahms", "handel", "haydn", "vivaldi",
  "chopin", "schubert", "tchaikovsky", "rachmaninov", "rachmaninoff", "mahler", "dvorak", "dvořák", "verdi", "puccini",
];
export const CLASSICAL_KEYWORDS = new RegExp(`(?<![\\p{L}])(?:${STEMS.join("|")})|(?<![\\p{L}])(?:${WORDS.join("|")})(?![\\p{L}])`, "iu");
