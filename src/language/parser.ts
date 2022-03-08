
import { createToken, Lexer, CstParser, RepetitionWithSeparator } from "chevrotain";
import type { IParserConfig, CstNode } from "chevrotain";
import { tokens, Fn, Identifier, LParen, RParen, Num, Str, Comma, Script, LCurly, RCurly, RivalsAILexer, Let, Equals, Return, MultiplicationOperator, AdditionOperator, IF, ELIF, ELSE, NOT, RelationalOperator, EquivalenceOperator, AND, OR, PlusPlus, MinusMinus, Define, Calculate, BitshiftOperator, BitAND, BitXOR, BitOR, VarReference, HexNum, BitShiftR, Collapse, Global, FILEDEF, OUT, EXTENDS, FromTarget, LOOP, BREAK } from './tokens';
import { IScript, ICommand, IVariable, IFuncCall, IFuncDef, IScope, ILocation, IIdentifier, IStr, IRawValue, PassedArg } from './definitions';
import * as vscode from 'vscode';

export class RivalsAIParser extends CstParser {

  constructor() {
    super(tokens, {nodeLocationTracking: "full"});

    const $ = this;

    $.RULE("file", () => {
      // $.SUBRULE($["defineScript"]);
      $.MANY(() => {
        $.OR([
          { ALT: () => $.SUBRULE($["defineScript"], {LABEL: "forcedOrder"}) },
          { ALT: () => $.SUBRULE($["defineFunction"], {LABEL: "forcedOrder"}) },
          { ALT: () => $.SUBRULE($["defineValue"], {LABEL: "forcedOrder"}) },
          { ALT: () => $.SUBRULE($["globDefine"], {LABEL: "forcedOrder"}) },
          { ALT: () => $.CONSUME(OUT) },
          { ALT: () => $.CONSUME(EXTENDS) },
          { ALT: () => $.SUBRULE($["fileIdentifier"], {LABEL: "forcedOrder"}) },
        ]);
      })
      // console.log(this);
    });

    $.RULE("fileIdentifier", () => {
      $.CONSUME(FILEDEF);
    })

    $.RULE("varArg", () => {
      $.OR([
        { ALT: () => $.SUBRULE($["expression"]) },
        { ALT: () => $.CONSUME(Str) },
      ])
    })

    $.RULE("passArgs", () => {
      $.CONSUME(LParen);
      $.MANY_SEP({
        SEP: Comma,
        DEF: () => {
          $.SUBRULE($["varArg"])
        }
      });
      $.CONSUME(RParen);
    });

    $.RULE("args", () => {
      $.CONSUME(LParen);
      $.MANY_SEP({
        SEP: Comma,
        DEF: () => $.OR([
          {ALT: () => $.CONSUME(Identifier, {LABEL: 'arguments'})},
          {ALT: () => $.CONSUME(VarReference, {LABEL: 'arguments'})},
        ])
      });
      $.CONSUME(RParen);
    });

    $.RULE("callUnk", () => {
      $.OPTION(() => { $.CONSUME(Collapse); });
      $.CONSUME(Identifier);
      $.SUBRULE($["passArgs"]);
    });

    $.RULE("defineValue", () => {
      $.CONSUME(Define);
      $.CONSUME(Identifier);
      $.SUBRULE($["expression"]);
    })

    $.RULE("defineScript", () => {
      $.CONSUME(Script);
      $.CONSUME(Identifier);
      $.SUBRULE($["args"]);
      $.SUBRULE($["scope"]);
    });

    $.RULE("defineFunction", () => {
      $.CONSUME(Fn);
      $.CONSUME(Identifier);
      $.SUBRULE($["args"]);
      $.SUBRULE($["scope"]);
    })

    ////////////////////////////////////////
    // arithmetic
    ////////////////////////////////////////
    $.RULE("expression", () => {
      $.SUBRULE($["logicalOR"])
    })

    $.RULE("logicalOR", () => {
      $.SUBRULE($["logicalAND"], {LABEL: 'lhs'});
      $.MANY(() => {
        $.CONSUME(OR);
        $.SUBRULE2($['logicalAND'], {LABEL: 'rhs'});
      })
    })
    
    $.RULE("logicalAND", () => {
      $.SUBRULE($["bitwiseOR"], {LABEL: 'lhs'});
      $.MANY(() => {
        $.CONSUME(AND);
        $.SUBRULE2($['bitwiseOR'], {LABEL: 'rhs'});
      })
    })

    $.RULE("bitwiseOR", () => {
      $.SUBRULE($["bitwiseXOR"], {LABEL: 'lhs'});
      $.MANY(() => {
        $.CONSUME(BitOR);
        $.SUBRULE2($['bitwiseXOR'], {LABEL: 'rhs'});
      })
    })

    $.RULE("bitwiseXOR", () => {
      $.SUBRULE($["bitwiseAND"], {LABEL: 'lhs'});
      $.MANY(() => {
        $.CONSUME(BitXOR);
        $.SUBRULE2($['bitwiseAND'], {LABEL: 'rhs'});
      })
    })

    $.RULE("bitwiseAND", () => {
      $.SUBRULE($["equivalenceExpression"], {LABEL: 'lhs'});
      $.MANY(() => {
        $.CONSUME(BitAND);
        $.SUBRULE2($['equivalenceExpression'], {LABEL: 'rhs'});
      })
    })

    $.RULE("equivalenceExpression", () => {
      $.SUBRULE($["relationalExpression"], {LABEL: 'lhs'});
      $.MANY(() => {
        $.CONSUME(EquivalenceOperator);
        $.SUBRULE2($['relationalExpression'], {LABEL: 'rhs'});
      })
    })

    $.RULE("relationalExpression", () => {
      $.SUBRULE($["bitShiftExpression"], {LABEL: 'lhs'});
      $.MANY(() => {
        $.CONSUME(RelationalOperator);
        $.SUBRULE2($['bitShiftExpression'], {LABEL: 'rhs'});
      })
    })

    $.RULE("bitShiftExpression", () => {
      $.SUBRULE($["additionExpression"], {LABEL: 'lhs'});
      $.MANY(() => {
        $.CONSUME(BitshiftOperator);
        $.SUBRULE2($['additionExpression'], {LABEL: 'rhs'});
      })
    })

    $.RULE("additionExpression", () => {
      $.SUBRULE($["multiplicationExpression"], {LABEL: 'lhs'});
      $.MANY(() => {
        $.CONSUME(AdditionOperator);
        $.SUBRULE2($['multiplicationExpression'], {LABEL: 'rhs'});
      })
    })

    $.RULE("multiplicationExpression", () => {
      $.SUBRULE($["atomicExpression"], {LABEL: 'lhs'});
      $.MANY(() => {
        $.CONSUME(MultiplicationOperator);
        $.SUBRULE2($['atomicExpression'], {LABEL: 'rhs'});
      })
    })

    $.RULE("atomicExpression", () => $.OR([
      { ALT: () => $.SUBRULE($['logicalNOT']) },
      { ALT: () => $.SUBRULE($['parenthesisExpression'])},
      { ALT: () => $.CONSUME(HexNum) },
      { ALT: () => $.CONSUME(Num) },
      { ALT: () => $.SUBRULE($["callUnk"]) },
      { ALT: () => $.SUBRULE($['preCalculate'])},
      { ALT: () => 
        {
          $.OPTION(() => $.CONSUME(FromTarget));
          $.CONSUME(Identifier) 
        }
      }
    ]))

    $.RULE("preCalculate", () => {
      $.CONSUME(Calculate);
      $.CONSUME(LParen);
      $.SUBRULE($["expression"]);
      $.CONSUME(RParen);
    })

    $.RULE("parenthesisExpression", () => {
      $.CONSUME(LParen);
      $.SUBRULE($["expression"]);
      $.CONSUME(RParen);
    })

    $.RULE("logicalNOT", () => {
      $.CONSUME(NOT);
      $.SUBRULE($["expression"]);
    })

    ////////////////////////////////////////
    // vars
    ////////////////////////////////////////

    $.RULE("varSet", () => {
      $.CONSUME(Identifier);
      $.OPTION(() => {
        $.OR([
          { ALT: () => $.CONSUME(AdditionOperator, {LABEL: 'operation'}) },
          { ALT: () => $.CONSUME(MultiplicationOperator, {LABEL: 'operation'}) },
        ])
      })
      $.CONSUME(Equals);
      $.SUBRULE($["expression"]);
    })

    $.RULE("varDefine", () => {
      $.CONSUME(Let);
      $.CONSUME(Identifier);
      $.CONSUME(Equals);
      $.SUBRULE($["expression"])
    })

    $.RULE("globDefine", () => {
      $.CONSUME(Global);
      $.CONSUME(Identifier);
    })

    $.RULE("returnStatement", () => {
      $.CONSUME(Return);
      $.OPTION(() => $.SUBRULE($["expression"]));
    })

    $.RULE("ifStatement", () => {
      $.CONSUME(IF)
      $.SUBRULE($["expression"], {LABEL: 'if_expr'})
      $.SUBRULE($["scope"], {LABEL: 'if_scope'})
      $.MANY(() => {
        $.CONSUME(ELIF)
        $.SUBRULE2($["expression"], {LABEL: 'elif_expr'})
        $.SUBRULE2($["scope"], {LABEL: 'elif_scope'})
      })
      $.OPTION(() => {
        $.CONSUME(ELSE)
        $.SUBRULE3($["scope"], {LABEL: 'else_scope'})
      })
    })

    $.RULE("loopStatement", () => {
      $.CONSUME(LOOP);
      $.SUBRULE($["scope"], {LABEL: 'loop_scope'});
    })

    $.RULE("scope", () => {
      $.CONSUME(LCurly);
      $.MANY({
        DEF: () => {
          $.OR([
            { ALT: () => $.CONSUME(BREAK) },
            { ALT: () => $.SUBRULE($["callUnk"]) },
            { ALT: () => $.SUBRULE($["varDefine"]) },
            { ALT: () => $.SUBRULE($["varSet"]) },
            { ALT: () => $.SUBRULE($["returnStatement"]) },
            { ALT: () => $.SUBRULE($["loopStatement"]) },
            { ALT: () => $.SUBRULE($["ifStatement"]) },
            { ALT: () => $.CONSUME(Identifier) }
          ])
        }
      });
      $.CONSUME(RCurly);
    })

    this.performSelfAnalysis();
  }
}