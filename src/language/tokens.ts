import { createToken as CT, ITokenConfig, TokenType, Lexer } from "chevrotain";

export const tokens: TokenType[] = [];
const createToken = (config: ITokenConfig) => {
  const newToken = CT(config);
  tokens.push(newToken);
  return newToken;
}

export const Whitespace = createToken({
  name: "Whitespace",
  pattern: /\s+/,
  group: Lexer.SKIPPED
});
export const Comment = createToken({ 
  name: "Comment", 
  pattern: /\/\/.*/, 
  group: Lexer.SKIPPED
});
export const MComment = createToken({ 
  name: "MComment", 
  pattern: /\/\*[\s\S]+?\*\//, 
  group: Lexer.SKIPPED,
  line_breaks: true 
});

// special things
export const FILEDEF = createToken({name: 'FILEDEF', pattern: /#__FILE__ .+/});
export const EXTENDS = createToken({name: 'EXTENDS', pattern: /#extends .+/});
export const OUT = createToken({name: 'OUT', pattern: /#out .+/});

export const Fn = createToken({ name: "Function", pattern: /fn/ });
export const Let = createToken({ name: "Let", pattern: /let/ });
export const Global = createToken({ name: "Global", pattern: /global/ });
export const Return = createToken({ name: "Return", pattern: /return\b/ });
export const Script = createToken({ name: "Script", pattern: /script/ });
export const Collapse = createToken({name: 'Collapse', pattern: /\bcollapse\b/});
export const FromTarget = createToken({ name: "FromTarget", pattern: /@/ });

export const Define = createToken({name: 'Define', pattern: /#define/});
export const Calculate = createToken({name: 'Calc', pattern: /#calc/});
export const IF = createToken({name: 'IF', pattern: /if\b/});
export const LOOP = createToken({name: 'LOOP', pattern: /loop\b/});
export const BREAK = createToken({name: 'BREAK', pattern: /break\b/});
export const ELIF = createToken({name: 'ELIF', pattern: /\belse if\b/});
export const ELSE = createToken({name: 'ELSE', pattern: /\belse\b/});
export const Str = createToken({ name: "string", pattern: /"[^"]*"/ });

export const VarReference = createToken({ name: "VarReference", pattern: /&[a-zA-Z_]+[a-zA-Z0-9_]*/, });
export const Identifier = createToken({ name: "Identifier", pattern: /[a-zA-Z_]+[a-zA-Z0-9_]*/, });
export const HexNum = createToken({ name: "hex", pattern: /0x[0-9a-fA-F]{1,8}/ });
export const Num = createToken({ name: "number", pattern: /-?\d+(?:\.\d+)?/ });
export const PlusPlus = createToken({ name: "PlusPlus", pattern: /\+\+/});
export const MinusMinus = createToken({ name: "MinusMinus", pattern: /--/});
export const LCurly = createToken({name: 'LCurly', pattern: /{/});
export const RCurly = createToken({name: 'RCurly', pattern: /}/});
export const LSquare = createToken({name: 'LSquare', pattern: /\[/});
export const RSquare = createToken({name: 'RSquare', pattern: /]/});
export const LParen = createToken({name: 'LParen', pattern: /\(/});
export const RParen = createToken({name: 'RParen', pattern: /\)/});
export const Comma = createToken({name: 'Comma', pattern: /,/});
export const Colon = createToken({name: 'Colon', pattern: /:/});
export const SemiColon = createToken({name: 'SemiColon', pattern: /;/});

export const AdditionOperator = createToken({name: 'AdditionOperator', pattern: Lexer.NA})
export const Plus = createToken({name: 'Plus', pattern: /\+/, categories: AdditionOperator});
export const Minus = createToken({name: 'Minus', pattern: /-/, categories: AdditionOperator});

export const MultiplicationOperator = createToken({name: 'MultiplicationOperator', pattern: Lexer.NA})
export const Multi = createToken({name: 'Multi', pattern: /\*/, categories: MultiplicationOperator});
export const Div = createToken({name: 'Div', pattern: /\//, categories: MultiplicationOperator});
export const Mod = createToken({name: 'Mod', pattern: /%/, categories: MultiplicationOperator});

export const BitshiftOperator = createToken({name: 'BitshiftOperator', pattern: Lexer.NA})
export const BitShiftL = createToken({name: 'LShift', pattern: /<</, categories: BitshiftOperator});
export const BitShiftR = createToken({name: 'RShift', pattern: />>/, categories: BitshiftOperator});


export const RelationalOperator = createToken({name: 'RelationalOperator', pattern: Lexer.NA})
export const GreaterThanOrEqual = createToken({name: 'GreaterThanOrEqual', pattern: />=/, categories: RelationalOperator});
export const LessThanOrEqual = createToken({name: 'LessThanOrEqual', pattern: /<=/, categories: RelationalOperator});
export const GreaterThan = createToken({name: 'GreaterThan', pattern: />/, categories: RelationalOperator});
export const LessThan = createToken({name: 'LessThan', pattern: /</, categories: RelationalOperator});

export const EquivalenceOperator = createToken({name: 'EquivalenceOperator', pattern: Lexer.NA})
export const NotEqual = createToken({name: 'NotEqual', pattern: /!=/, categories: EquivalenceOperator});
export const IsEqual = createToken({name: 'IsEqual', pattern: /==/, categories: EquivalenceOperator})

export const AND = createToken({name: 'AND', pattern: /&&/});
export const OR = createToken({name: 'OR', pattern: /\|\|/});
export const NOT = createToken({name: 'NOT', pattern: /!/});

export const BitAND = createToken({name: 'BitAND', pattern: /&/})
export const BitXOR = createToken({name: 'BitXOR', pattern: /\^/})
export const BitOR = createToken({name: 'BitOR', pattern: /\|/})

export const Equals = createToken({name: 'Equals', pattern: /=/});

export const RivalsAILexer = new Lexer(tokens);