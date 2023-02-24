import { ICstVisitor } from "@chevrotain/types";
import { IVariable, IFuncDef, IScript, IScope, PassedArg, IFuncCall, FnCallKind, IVarInitInfo, IExpression, Operator, ICommand, callType, IRawValue, IDefined, Arguments, IIdentifier, IFileIdent } from './definitions';
import { CstNode, tokenMatcher } from 'chevrotain';
import { RivalsAIParser } from './parser';
import { Div, Multi, Plus, LessThan, LessThanOrEqual, GreaterThanOrEqual, Equals, IsEqual, BitShiftL, RivalsAILexer } from './tokens';
import { IBuiltins } from "./getIncludeData";
import { basename } from "path";
import * as vscode from 'vscode';

export class DuplicateIdentifierException extends Error {
  constructor(
    public currFile: IFileIdent,
    public startLine: number,
    public startColumn: number,
    public image: string,
    public identFile: IFileIdent,
    public identStartLine: number,
    public identStartColumn: number,
  ) {
    super(`[${startLine - currFile.startLine}, ${startColumn}]: identifier '${image}' already exists @ (${identStartLine}, ${identStartColumn})`);
    // this.identStartLine += currFile.startLine;
  }
}

export class HangingIdentifierException extends Error {
  constructor(
    public currFile: IFileIdent,
    public startLine: number,
    public startColumn: number,
    public image: string,
  ) {
    super(`[${startLine - currFile.startLine}, ${startColumn}]: cannot have a lone identifier`);
    // this.identStartLine += currFile.startLine;
  }
}

export class CallDNEException extends Error {
  constructor(
    public currFile: IFileIdent,
    public startLine: number,
    public startColumn: number,
    public image: string
  ) {
    super(`${basename(currFile.name)}: [${startLine - currFile.startLine}, ${startColumn}]: trying to call ${image} but it does not exist`)
  }
}

export class ArgCountMismatchException extends Error {
  constructor(
    public currFile: IFileIdent,
    public startLine: number,
    public startColumn: number,
    public image: string,
    public argCount: number,
    public fnName: string,
    public targetArgCount: number
  ) {
    super(`[${startLine - currFile.startLine}, ${startColumn}]: giving ${argCount} arguments but ${fnName} takes ${targetArgCount}`);
  }
}

export class RefArgMismatchException extends Error {
  constructor(
    public currFile: IFileIdent,
    public startLine: number,
    public startColumn: number,
    public image: string
  ) {
    super(`[${startLine - currFile.startLine}, ${startColumn}]: trying to pass a non-variable to a variable reference`);
  }
}

export class ReservedException extends Error {
  constructor(
    public currFile: IFileIdent,
    public startLine: number,
    public startColumn: number,
    public image: string,
    public kind: string
  ) {
    super(`[${startLine - currFile.startLine}, ${startColumn}]: ${image} is a reserved global ${kind}`);
  }
}

export class IdentDNEException extends Error {
  constructor(
    public currFile: IFileIdent,
    public startLine: number,
    public startColumn: number,
    public image: string
  ) {
    super(`${basename(currFile.name)}: [${startLine - currFile.startLine}, ${startColumn}]: variable ${image} does not exist`)
  }
}


export const customVisitorFactory = (parser: RivalsAIParser, builtins: IBuiltins, baseClass: new (...args: any[]) => ICstVisitor<any, any>) => {
  const getBuiltinByName = (name: string): IFuncCall => {
    const cmd = builtins.cmds.find(v => v.name == name);
    return {
      kind: 'builtin',
      id: cmd!.raw!,
      name: cmd!.name,
      arguments: []
    }
  }

  const rebuildStringFromCstNode = (node: any): string => { 
    let out = "";
    if (node.image) out = node.image;
    else {
      for (const nod of Object.values(node) as any[]) {
        if (Array.isArray(nod)) {
          for (const no of nod) {
            out += rebuildStringFromCstNode(no);
          }
        } else if (nod && typeof nod === "object") {
          if (nod.image) out += nod.image;
          else if (nod.children) out += rebuildStringFromCstNode(nod.children);
          else out += rebuildStringFromCstNode(nod);
        }
      }
    }
    return out;
  }

  class CustomVisitor extends baseClass {
    public globals: IVariable[] = [];
    public fns: IFuncDef[] = [];
    public scripts: IScript[] = [];
    public anonymousScopes: {[key: number]: IScope[]} = [];
    public mainScript?: IScript;
    public defines: IDefined[] = [];
    public fileIdent: IFileIdent = { 
      name: "DEFAULT",
      startLine: 0
    };
    public currFile: string = "";
    public currDepth: number = 0;
    public completionItems: IIdentifier[] = [];

    constructor() {
      super();

      this.validateVisitor();
    }



    processBody(item: IFuncDef | IScript) {
      item.scope = this.visit(item.scopeCtx!, item);
    }

    globDefine(ctx: CstNode): IVariable {
      return {
        file: this.fileIdent,
        location: {
          file: this.fileIdent.name,
          startLine: ctx.location?.startLine! - this.fileIdent.startLine,
          startColumn: ctx.location?.startColumn!,
          endLine: ctx.location?.endLine! - this.fileIdent.startLine,
          endColumn: ctx.location?.endColumn!
        },
        name: ctx["Identifier"][0].image,
        idKind: "global"
      }
    }

    preCalculate(ctx: CstNode, parent: IScope) {
      let out: string = rebuildStringFromCstNode(ctx);
      for (const def of this.defines) {
        if (out.includes(def.name)) out = out.replace(new RegExp(def.name, "g"), def.expanded || "");
      }
      out = `${eval(out.substring(6, out.length - 1))}`;
      // console.log("PRECALCULATION", out);
      return {
        ...ctx,
        image: out
      };
    }

    preProcessDefine(def: IDefined, depth: number = 0) {
      if (depth >= 100) throw new Error("too many dependent defines");
      let trueString: string = def.text;
      for (const define of this.defines) {
        if (trueString.includes(define.name)) {
          if (!define.expanded) this.preProcessDefine(define, depth + 1);
          trueString = trueString.replace(new RegExp(define.name, "g"), define.expanded!);
        }
      }

      def.expanded = trueString;

      const tokenization = RivalsAILexer.tokenize(trueString);
      if (tokenization.errors.length > 0) {
        throw tokenization.errors[0];
      }
      
      parser.input = tokenization.tokens;
      const CstNode = parser["expression"]();
      
      if (parser.errors.length > 0) {
        throw parser.errors[0];
      }

      def.node = CstNode;
    }

    fileIdentifier(ctx: CstNode) {
      // console.log(ctx);
      return {
        name: ctx["FILEDEF"][0].image.substring(10),
        startLine: ctx["FILEDEF"][0].startLine + 1
      }
    }

    file(ctx: CstNode, fullFile: string) {
      this.currDepth += 1;
      this.currFile = fullFile;
      this.anonymousScopes[this.currDepth] = [];
      for (const node of ctx["forcedOrder"]) {
        switch (node.name) {
          case "fileIdentifier": this.fileIdent = this.visit(node); break;
          case "defineValue": this.defines.push(this.visit(node)); break;
          // case "defineScript": {
          //   const scr: IScript = this.visit(node);
          //   if (scr.name === "main") this.mainScript = scr;
          //   else this.scripts.push(scr);
          //   break;
          // }
          case "defineScript":
          case "defineFunction": this.visit(node); break;
          case "globDefine": this.globals.push(this.visit(node)); break;
        }
      }
      if (!this.mainScript) throw new Error("missing main script!");

      for (const define of this.defines) {
        if (!define.node) this.preProcessDefine(define);
      }

      for (const fn of this.fns) 
        this.processBody(fn);
      for (const script of this.scripts) {
        this.processBody(script);
        script.scope!.commands.pop();
        // implicit Loopback 
        script.scope!.commands.push({
          name: "Loopback",
          arguments: [],
          id: builtins.cmds[builtins.cmds.map(c => c.name).indexOf('Loopback')].raw!,
          kind: 'builtin',
        })
      }
      this.processBody(this.mainScript);
      this.mainScript.scope!.commands.pop();
      this.mainScript.scope!.commands.push({
        name: "Loopback",
        arguments: [],
        id: builtins.cmds[builtins.cmds.map(c => c.name).indexOf('Loopback')].raw!,
        kind: 'builtin',
      })
      
      // console.log(this.anonymousScopes[this.currDepth].filter(s => s.file.name === "movement.rai" && s['id'] >= 22));
    }
    defineValue(ctx: CstNode): IDefined {
      const strToParse = this.currFile.substring(ctx["expression"][0].location.startOffset, ctx["expression"][0].location.endOffset + 1);
      return {
        file: this.fileIdent,
        name: ctx["Identifier"][0].image,
        text: strToParse,
        idKind: "define",
        location: ctx["Identifier"][0].location
      }
    }
    varArg(ctx: CstNode, parent: IScope): PassedArg { 
      switch(Object.keys(ctx)[0]) {
        case "string": {
          let str = ctx["string"][0].image;
          str = str.substr(1, str.length - 2);
          parent.rawStrings.push(str);
          return { 
            kind: 'string', 
            id: parent.rawStrings.length - 1,
            content: str
          }
        }
        case "expression": {
          const out: IExpression = this.visit(ctx['expression'][0], parent);
          return {
            kind: 'expression',
            id: out.op,
            ...out
          }
        }
        default:
          throw new Error("something ain't right here...");
      }
    }
    passArgs(ctx: CstNode, parent: IScope) { 
      const out: PassedArg[] = [];
      if (ctx["varArg"]) for (const arg of ctx["varArg"]) {
        out.push(this.visit(arg, parent));
      }
      return out;
    }
    args(ctx: CstNode): Arguments { 
      if (!ctx["arguments"]) return [];
      const out: Arguments = [];
      out.refCount = 0;
      for (const id of ctx["arguments"]) {
        if (id.image.startsWith("&")) {
          out.refCount += 1;
          id.image = id.image.substring(1);
        }
        const arr = [...this.globals, ...this.scripts, ...this.fns, ...out];
        let idx;
        if ((idx = arr.map(v => v.name).indexOf(id.image)) != -1) {
          throw new DuplicateIdentifierException(this.fileIdent, id.startLine, id.startColumn!, id.image, arr[idx].file, arr[idx].location.startLine, arr[idx].location.startColumn!);
        }

        out.push({ 
          file: this.fileIdent,
          name: id.image, 
          location: {
            file: this.fileIdent.name,
            startLine: id.startLine - this.fileIdent.startLine,
            startColumn: id.startColumn,
            endLine: id.endLine - this.fileIdent.startLine,
            endColumn: id.endColumn
          },
          idKind: "arg"
        });
      }
      
      return out;
    }
    callUnk(ctx: CstNode, parent: IScope): IFuncCall { 
      const id = ctx["Identifier"][0];
      let idx;
      let definedFn: IFuncDef;
      let kind: FnCallKind;
      if ((idx = this.scripts.map(scr => scr.name).indexOf(id.image)) != -1) {
        definedFn = this.scripts[idx];
        kind = 'script';
      } else if ((idx = this.fns.map(fn => fn.name).indexOf(id.image)) != -1) {
        definedFn = this.fns[idx];
        kind = 'function';
      } else if ((idx = builtins.cmds.map(b => b.name).indexOf(id.image)) != -1) {
        definedFn = builtins.cmds[idx];
        kind = 'builtin';
      } else if (this.mainScript && id.image == "main") {
        definedFn = this.mainScript;
        idx = -1;
        kind = 'script';
      } else {
        console.log(this.fns);
        throw new CallDNEException(parent.file, id.startLine, id.startColumn, id.image);
      }

      const args = this.visit(ctx["passArgs"], parent);
      // special condition for the builtin Print command
      if (id.image !== "Print" && definedFn.getArgCount() != args.length) {
        throw new ArgCountMismatchException(parent.file, id.startLine, id.startColumn, id.image, args.length, definedFn.name, definedFn.getArgCount());
      } else if (id.image === "Print" && args.length === 0) {
        throw new Error(`[${id.startLine - parent.file.startLine}, ${id.startColumn}]: giving ${args.length} arguments but ${definedFn.name} takes at least a string!`)
      }
      for (let i = 0; i < (definedFn.arguments.refCount || 0); i++) {
        if (args[i].kind != 'identifier') 
          throw new RefArgMismatchException(parent.file, id.startLine, id.endLine, args[i].image);
      }

      const funcCall: IFuncCall = {
        name: id.image,
        arguments: args,
        id: definedFn.raw ?? (kind === 'script' ? idx + 1: idx),
        kind
      }
      return funcCall;
    }
    defineFunction(ctx: CstNode) { 
      const ident = ctx["Identifier"][0];

      const arr = this.fns;
      let idx;

      const existingSymbols = [...this.scripts, ...this.globals];
      if ((idx = existingSymbols.map(v => v.name).indexOf(ident.image)) != -1) {
        throw new DuplicateIdentifierException(this.fileIdent, ident.startLine, ident.startColumn!, ident.image, existingSymbols[idx].file, existingSymbols[idx].location.startLine, existingSymbols[idx].location.startColumn!);
      } else if ((idx = builtins.cmds.map(v => v.name).indexOf(ident.image)) != -1) {
        throw new ReservedException(this.fileIdent, ident.startLine, ident.startColumn, ident.image, "command");
      } else if ((idx = this.fns.map(v => v.name).indexOf(ident.image)) != -1 && this.currDepth == this.fns[idx].depth) {
        throw new DuplicateIdentifierException(this.fileIdent, ident.startLine, ident.startColumn!, ident.image, this.fns[idx].file, this.fns[idx].location.startLine, this.fns[idx].location.startColumn!);
      } else if (ident.image === "main") {
        throw new ReservedException(this.fileIdent, ident.startLine, ident.startColumn, ident.image, "script");
      }

      const $ = this;
      const fn: IFuncDef = {
        depth: this.currDepth,
        file: this.fileIdent,
        name: ident.image,
        arguments: this.visit(ctx["args"]),
        getArgCount() { return this.arguments.length; },
        getAllIdents() { return [...$.globals, ...$.fns, ...$.scripts, ...this.arguments] },
        getAllVars() { return [...$.globals, ...this.arguments] },
        location: {
          file: this.fileIdent.name,
          startLine: ident.startLine - this.fileIdent.startLine,
          startColumn: ident.startColumn,
          endLine: ident.endLine - this.fileIdent.startLine,
          endColumn: ident.endColumn
        },
        idKind: "funcDef"
      }
      fn.scopeCtx = ctx["scope"];
      if (idx == -1) this.fns.push(fn);
      else this.fns[idx] = fn;
      return;
    }
    expression(ctx: CstNode, parent: IScope) {
      return this.visit(ctx['logicalOR'], parent);
    }
    logicalNOT(ctx: CstNode, parent: IScope): IExpression {
      let result = this.visit(ctx['expression'], parent);
      result = { kind: 'expression', lhs: result, op: Operator.NOT }
      return result;
    }
    logicalOR(ctx: CstNode, parent: IScope): IExpression {
      let result = this.visit(ctx['lhs'], parent);

      if (ctx['rhs']) {
        for (const [idx, rhsOperand] of ctx['rhs'].entries()) {
          let rhsArg = this.visit(rhsOperand, parent);
          result = { kind: 'expression', lhs: result, op: Operator.OR, rhs: rhsArg }
        }
      }

      return result;
    }
    logicalAND(ctx: CstNode, parent: IScope): IExpression {
      let result = this.visit(ctx['lhs'], parent);

      if (ctx['rhs']) {
        for (const [idx, rhsOperand] of ctx['rhs'].entries()) {
          let rhsArg = this.visit(rhsOperand, parent);
          result = { kind: 'expression', lhs: result, op: Operator.AND, rhs: rhsArg }
        }
      }

      return result;
    }
    bitwiseXOR(ctx: CstNode, parent: IScope): IExpression {
      let result = this.visit(ctx['lhs'], parent);

      if (ctx['rhs']) {
        for (const [idx, rhsOperand] of ctx['rhs'].entries()) {
          let rhsArg = this.visit(rhsOperand, parent);
          result = { kind: 'expression', lhs: result, op: Operator.BXOR, rhs: rhsArg }
        }
      }

      return result;
    }
    bitwiseOR(ctx: CstNode, parent: IScope): IExpression {
      let result = this.visit(ctx['lhs'], parent);

      if (ctx['rhs']) {
        for (const [idx, rhsOperand] of ctx['rhs'].entries()) {
          let rhsArg = this.visit(rhsOperand, parent);
          result = { kind: 'expression', lhs: result, op: Operator.BOR, rhs: rhsArg }
        }
      }

      return result;
    }
    bitwiseAND(ctx: CstNode, parent: IScope): IExpression {
      let result = this.visit(ctx['lhs'], parent);

      if (ctx['rhs']) {
        for (const [idx, rhsOperand] of ctx['rhs'].entries()) {
          let rhsArg = this.visit(rhsOperand, parent);
          result = { kind: 'expression', lhs: result, op: Operator.BAND, rhs: rhsArg }
        }
      }

      return result;
    }
    equivalenceExpression(ctx: CstNode, parent: IScope): IExpression {
      let result = this.visit(ctx['lhs'], parent);

      if (ctx['rhs']) {
        for (const [idx, rhsOperand] of ctx['rhs'].entries()) {
          let rhsArg = this.visit(rhsOperand, parent);
          let operator = ctx['EquivalenceOperator'][idx];
          let op: Operator = Operator.EQ;
          if (tokenMatcher(operator, IsEqual)) {
            op = Operator.EQ;
          } else {
            op = Operator.NEQ;
          }
          result = { kind: 'expression', lhs: result, op, rhs: rhsArg }
        }
      }

      return result;
    }
    relationalExpression(ctx: CstNode, parent: IScope): IExpression {
      let result = this.visit(ctx['lhs'], parent);

      if (ctx['rhs']) {
        for (const [idx, rhsOperand] of ctx['rhs'].entries()) {
          let rhsArg = this.visit(rhsOperand, parent);
          let operator = ctx['RelationalOperator'][idx];
          let op: Operator = Operator.MUL;
          if (tokenMatcher(operator, LessThan)) {
            op = Operator.LES;
          } else if (tokenMatcher(operator, LessThanOrEqual)) {
            op = Operator.LEQ;
          } else if (tokenMatcher(operator, GreaterThanOrEqual)) {
            op = Operator.GEQ;
          } else {
            op = Operator.GR;
          }
          result = { kind: 'expression', lhs: result, op, rhs: rhsArg }
        }
      }

      return result;
    }
    bitShiftExpression(ctx: CstNode, parent: IScope): IExpression {
      let result = this.visit(ctx['lhs'], parent);

      if (ctx['rhs']) {
        for (const [idx, rhsOperand] of ctx['rhs'].entries()) {
          let rhsArg = this.visit(rhsOperand, parent);
          let operator = ctx['BitshiftOperator'][idx];
          let op: Operator = Operator.BSR;
          if (tokenMatcher(operator, BitShiftL)) {
            op = Operator.BSL;
          } else {
            op = Operator.BSR;
          }
          result = { kind: 'expression', lhs: result, op, rhs: rhsArg }
        }
      }

      return result;
    }
    additionExpression(ctx: CstNode, parent: IScope): IExpression {
      let result = this.visit(ctx['lhs'], parent);

      if (ctx['rhs']) {
        for (const [idx, rhsOperand] of ctx['rhs'].entries()) {
          let rhsArg = this.visit(rhsOperand, parent);
          let operator = ctx['AdditionOperator'][idx];
          let op: Operator = Operator.SUB;
          if (tokenMatcher(operator, Plus)) {
            op = Operator.ADD;
          } else {
            op = Operator.SUB;
          }
          result = {
            kind: 'expression',
            lhs: result,
            op,
            rhs: rhsArg
          }
        }
      }

      return result;
    }
    multiplicationExpression(ctx: CstNode, parent: IScope): IExpression {
      let result = this.visit(ctx['lhs'], parent);

      if (ctx['rhs']) {
        for (const [idx, rhsOperand] of ctx['rhs'].entries()) {
          let rhsArg = this.visit(rhsOperand, parent);
          let operator = ctx['MultiplicationOperator'][idx];
          let op: Operator = Operator.MUL;
          if (tokenMatcher(operator, Multi)) {
            op = Operator.MUL;
          } else if (tokenMatcher(operator, Div)) {
            op = Operator.DIV;
          } else {
            op = Operator.MOD;
          }
          result = { kind: 'expression', lhs: result, op, rhs: rhsArg }
        }
      }

      return result;
    }
    atomicExpression(ctx: CstNode, parent: IScope) {
      if (ctx["logicalNOT"]) {
        return this.visit(ctx["logicalNOT"], parent);
      }
      if (ctx["parenthesisExpression"]) {
        return this.visit(ctx["parenthesisExpression"], parent);
      }
      switch(Object.keys(ctx)[0]) {
        case "preCalculate": {
          const val = parseFloat(this.visit(ctx["preCalculate"], parent).image);
          parent.rawValues.push(val);
          return { 
            kind: 'number',
            id: parent.rawValues.length - 1,
            value: val
          }
        }
        case "hex": {
          parent.rawValues.push(parseInt(ctx["hex"][0].image.substring(2), 16));
          return { 
            kind: 'number',
            id: parent.rawValues.length - 1,
            value: parseInt(ctx["hex"][0].image.substring(2), 16)
          }
        }
        case "number": {
          parent.rawValues.push(parseFloat(ctx["number"][0].image));
          return { 
            kind: 'number',
            id: parent.rawValues.length - 1,
            value: parseFloat(ctx["number"][0].image)
          }
        }
        case "callUnk": {
          return { 
            kind: 'function', 
            ...this.visit(ctx["callUnk"][0], parent)
          };
        }
        case "FromTarget":
        case "Identifier": {
          const id = ctx["Identifier"][0];
          const common = {
            name: id.image,
            location: {
              startLine: id.startLine - parent.file.startLine,
              startColumn: id.startColumn,
              endLine: id.endLine - parent.file.startLine,
              endColumn: id.endColumn
            }
          };
          let idx;
          if ((idx = this.defines.map(def => def.name).indexOf(id.image)) != -1) {
            return this.visit(this.defines[idx].node!, parent);
          } else if ((idx = parent.getAllVars().map(id => id.name).indexOf(id.image)) != -1) {
            return {
              kind: 'identifier',
              id: idx,
              ...common
            }
          } else if ((idx = this.scripts.map(id => id.name).indexOf(id.image)) != -1) {
            return {
              kind: 'raw',
              id: idx + 1,
              ...common
            }
          } else if ((idx = builtins.globals.map(id => id.name).indexOf(id.image)) != -1) {
            return {
              kind: ctx["FromTarget"] ? 'builtin-rel' : 'builtin',
              id: idx,
              ...common
            }
          }

          throw new IdentDNEException(parent.file, id.startLine, id.startColumn, id.image);
        }
        default:
          throw new Error("something ain't right here...");
      }
    }
    parenthesisExpression(ctx: CstNode, parent: IScope) {
      return this.visit(ctx['expression'], parent);
    }
    varDefine(ctx: CstNode, parent: IScope): IVarInitInfo {
      const varNameInfo = ctx["Identifier"][0];
      const arr = parent.getAllIdents();
      let idx;
      if ((idx = arr.map(v => v.name).indexOf(varNameInfo.image)) != -1) {
        throw new DuplicateIdentifierException(this.fileIdent, varNameInfo.startLine, varNameInfo.startColumn!, varNameInfo.image, arr[idx].file, arr[idx].location.startLine, arr[idx].location.startColumn!);
      } else if ((idx = builtins.globals.map(v => v.name).indexOf(varNameInfo.image)) != -1) {
        throw new ReservedException(this.fileIdent, varNameInfo.startLine, varNameInfo.startColumn, varNameInfo.image, "variable");
      }

      let expression;
      if (ctx['expression']) expression = this.visit(ctx['expression'], parent);
      return {
        variable: {
          file: parent.file,
          name: varNameInfo.image,
          location: {
            file: parent.file.name,
            startLine: varNameInfo.startLine - parent.file.startLine,
            startColumn: varNameInfo.startColumn,
            endLine: varNameInfo.endLine - parent.file.startLine,
            endColumn: varNameInfo.endColumn
          },
          idKind: "variable",
        },
        expression,
        initializeOnly: (!!ctx["initializer"] && expression)
      };
    }
    varSet(ctx: CstNode, parent: IScope): ICommand {
      const varNameInfo = ctx["Identifier"][0];
      const arr = parent.getAllVars();
      let idx;
      if ((idx = arr.map(v => v.name).indexOf(varNameInfo.image)) == -1) {
        throw new IdentDNEException(parent.file, varNameInfo.startLine, varNameInfo.startColumn, varNameInfo.image);
      }
      
      const out = getBuiltinByName("SetVariable");
      out.arguments.push({
        kind: 'identifier',
        id: idx,
        value: 0
      });
      let expr: IExpression = this.visit(ctx["expression"], parent);
      
      if (ctx["operation"]) {
        const opId: Operator = (() => { switch (ctx["operation"].image) {
          default: return Operator.NOT;
          case "+": return Operator.ADD;
          case "-": return Operator.SUB;
          case "*": return Operator.MUL;
          case "/": return Operator.DIV;
        }})()

        expr = {
          lhs: {kind: 'identifier', id: idx, value: 0},
          op: opId,
          rhs: { kind: 'expression', id: expr.op, ...expr}
        };
      }

      out.arguments.push({
        kind: 'expression',
        id: expr.op,
        ...expr
      });
      return out;
    }
    defineScript(ctx: CstNode) { 
      const ident = ctx["Identifier"][0];

      const arr = this.scripts;

      let idx;

      const existingSymbols = [...this.fns, ...this.globals];
      if ((idx = existingSymbols.map(v => v.name).indexOf(ident.image)) != -1) {
        throw new DuplicateIdentifierException(this.fileIdent, ident.startLine, ident.startColumn!, ident.image, existingSymbols[idx].file, existingSymbols[idx].location.startLine, existingSymbols[idx].location.startColumn!);
      } else if ((idx = builtins.cmds.map(v => v.name).indexOf(ident.image)) != -1) {
        throw new ReservedException(this.fileIdent, ident.startLine, ident.startColumn, ident.image, "command");
      } else if ((idx = arr.map(v => v.name).indexOf(ident.image)) != -1 && this.currDepth == this.scripts[idx].depth) {
        throw new DuplicateIdentifierException(this.fileIdent, ident.startLine, ident.startColumn!, ident.image, arr[idx].file, arr[idx].location.startLine, arr[idx].location.startColumn!);
      } else if (ident.image === "main" && this.mainScript && this.mainScript.depth == this.currDepth) {
        throw new DuplicateIdentifierException(this.fileIdent, ident.startLine, ident.startColumn!, ident.image, this.mainScript.file, this.mainScript.location.startLine, this.mainScript.location.startColumn!);
      }

      const $ = this;
      const script: IScript = {
        depth: this.currDepth,
        file: this.fileIdent,
        name: ident.image,
        arguments: this.visit(ctx["args"]),
        getAllIdents() { return [...$.globals, ...$.fns, ...$.scripts, ...this.arguments] },
        getAllVars() { return [...$.globals, ...this.arguments] },
        getArgCount() { return this.arguments.length; },
        location: {
          file: this.fileIdent.name,
          startLine: ident.startLine - this.fileIdent.startLine,
          startColumn: ident.startColumn,
          endLine: ident.endLine - this.fileIdent.startLine,
          endColumn: ident.endColumn
        },
        idKind: "scriptDef"
      }
      script.scopeCtx = ctx["scope"];
      if (script.name === "main") {
        this.mainScript = script;
      } else {
        if (idx == -1) this.scripts.push(script);
        else this.scripts[idx] = script;
      }
      return;
    }
    returnStatement(ctx: CstNode, parent: IScope) { 
      const ret = getBuiltinByName('Return');
      if (ctx["expression"]) {
        ret.arguments.push({
          kind: 'expression',
          ...this.visit(ctx['expression'], parent)
        })
      } else {
        ret.arguments.push({
          kind: 'number',
          id: 0,
          value: 0
        });
      }
      ret.arguments.push({
        kind: 'raw',
        id: callType.FUNCTION,
        value: -1,
      })
      parent.commands.push(ret);
    }
    loopStatement(ctx: CstNode, parent: IScope) {
      const baseLoop = getBuiltinByName('Loop');
      this.anonymousScopes[this.currDepth].push({} as any);

      baseLoop.arguments.push({
        id: this.anonymousScopes[this.currDepth].length - 1,
        kind: 'raw',
        value: -1
      })
      this.anonymousScopes[this.currDepth][this.anonymousScopes[this.currDepth].length - 1] = {
        id: this.anonymousScopes[this.currDepth].length - 1,
        ...this.visit(ctx["loop_scope"][0], parent)
      }

      parent.commands.push(baseLoop);
    }
    ifStatement(ctx: CstNode, parent: IScope) {
      const myAnons = this.anonymousScopes[this.currDepth];
      const baseIf = getBuiltinByName('If');
      const ifExpr: IExpression = this.visit(ctx["if_expr"][0], parent);
      baseIf.arguments.push({
        kind: 'raw',
        id: 0,
        value: -1
      });
      baseIf.arguments.push({
        kind: 'expression',
        id: ifExpr.op,
        ...ifExpr
      });
      myAnons.push({} as any);
      let tempLen = myAnons.length - 1;
      baseIf.arguments.push({
        id: -1,
        kind: 'raw',
        value: -1
      })
      myAnons[myAnons.length - 1] = {
        id: myAnons.length - 1,
        ...this.visit(ctx["if_scope"][0], parent)
      }
      baseIf.arguments[baseIf.arguments.length - 1].id = myAnons[tempLen]['id']
      
      if (ctx["elif_expr"]) {
        for (const [idx, scope] of ctx["elif_scope"].entries()) {
          const elifExpr: IExpression = this.visit(ctx["elif_expr"][idx], parent);
          baseIf.arguments.push({
            kind: 'raw',
            id: 1,
            value: -1
          });
          baseIf.arguments.push({
            kind: 'expression',
            id: elifExpr.op,
            ...elifExpr
          });
          myAnons.push({} as any);
          tempLen = myAnons.length - 1;
          baseIf.arguments.push({
            id: -1,
            kind: 'raw',
            value: -1
          })
          myAnons[myAnons.length - 1] = {
            id: myAnons.length - 1,
            ...this.visit(scope, parent)
          }
          baseIf.arguments[baseIf.arguments.length - 1].id = myAnons[tempLen]['id']
        }
      }
      if (ctx["else_scope"]) {
        baseIf.arguments.push({
          kind: 'raw',
          id: 2,
          value: -1
        });
        myAnons.push({} as any);
        tempLen = myAnons.length - 1;
        baseIf.arguments.push({
          id: myAnons.length - parent.scopeDepth,
          kind: 'raw',
          value: -1
        })
        myAnons[myAnons.length - 1] = {
          id: myAnons.length - 1,
          ...this.visit(ctx["else_scope"], parent)
        }
        baseIf.arguments[baseIf.arguments.length - 1].id = myAnons[tempLen]['id']
      }
      baseIf.arguments.push({
        kind: 'raw',
        id: 3,
        value: -1
      });
      parent.commands.push(baseIf);
      // console.log("DEPTH: ", parent.scopeDepth, baseIf.arguments[2].id);
    }
    scope(ctx: CstNode, parent: IScope | IScript): IScope { 
      const scope: IScope = {
        depth: this.currDepth,
        file: parent.file,
        scopeDepth: (parent['scopeDepth'] ? parent['scopeDepth'] + 1 : 1),
        parent,
        rawStrings: [],
        rawValues: [],
        commands: [],
        variables: [],
        getAllIdents() { return [...this.variables, ...this.parent.getAllIdents()] },
        getAllVars() { return [...this.parent.getAllVars(), ...this.variables ] }
      };
      // console.log("SCOPEDEPTH: ", scope['scopeDepth']);
      const toProcess = [
        ...(ctx["varDefine"] ? ctx["varDefine"] : []), 
        ...(ctx["varSet"] ? ctx["varSet"] : []),
        ...(ctx["callUnk"] ? ctx["callUnk"] : []),
        ...(ctx["returnStatement"] ? ctx["returnStatement"] : []),
        ...(ctx["ifStatement"] ? ctx["ifStatement"] : []),
        ...(ctx["loopStatement"] ? ctx["loopStatement"] : []),
        ...(ctx["BREAK"] ? ctx["BREAK"] : []),
        ...(ctx["Identifier"] ? ctx["Identifier"] : [])
      ].sort((a, b) => ((a.location) ? a.location.startOffset : a.startOffset) - ((b.location) ? b.location.startOffset : b.startOffset));

      const selection = vscode.window.activeTextEditor?.selection.active;
      for (const [i, item] of toProcess.entries()) {

        switch (item.name ?? item.tokenType.name ?? item.image) {
          case "varDefine": {
            const varInfo: IVarInitInfo = this.visit(item, scope);
            scope.variables.push(varInfo.variable); 
            const createVar = getBuiltinByName('CreateVariable');
            createVar.arguments.push({
              kind: 'raw',
              id: (varInfo.initializeOnly) ? 1 : 0,
              value: -1
            });
            scope.commands.push(createVar);
            if (varInfo.expression) {
              const setVar = getBuiltinByName('SetVariable');
              setVar.arguments.push({
                kind: 'identifier',
                id: scope.getAllVars().length - 1,
                value: 0
              })
              setVar.arguments.push({
                kind: 'expression',
                id: varInfo.expression.op,
                ...varInfo.expression
              })
              scope.commands.push(setVar);
            }
            break;
          }
          case "loopStatement":
          case "returnStatement":
          case "ifStatement": {
            this.visit(item, scope);
            break;
          }
          case "varSet": {
            scope.commands.push(this.visit(item, scope));
            break;
          }
          case "BREAK": {
            const breakStatement = getBuiltinByName('Return')
            scope.rawValues.push(0);
            breakStatement.arguments.push({
              kind: 'number',
              id: scope.rawValues.length - 1,
              value: 0
            });
            breakStatement.arguments.push({ 
              kind: 'raw',
              id: callType.LOOP,
              value: 0
            });
            scope.commands.push(breakStatement);
            break;
          }
          case "callUnk": {
            const toCall = this.visit(item, scope) as IFuncCall;
            switch (toCall.kind) {
              case 'builtin': scope.commands.push(toCall); break;
              case 'function': {
                const callFn = getBuiltinByName("CallFn");
                callFn.arguments.push({...toCall});
                scope.commands.push(callFn);
                break;
              }
              case 'script': {
                let command;
                if (item.children["Collapse"]) command = getBuiltinByName('Collapse');
                else command = getBuiltinByName('CallScript');
                command.arguments.push({...toCall});
                scope.commands.push(command);
                break;
              }
            }
            break;
          }
          case "Identifier": {
            if (!(selection 
              && vscode.window.activeTextEditor?.document.uri.fsPath === parent.file.name
              && item.startLine - parent.file.startLine - 1 == selection.line 
              && item.endColumn == selection.character)
            ) {
              throw new HangingIdentifierException(parent.file, item.location.startLine, item.location.startColumn, item.image);
            }
          }
        }

        if (i < toProcess.length) {
          // @ts-ignore
          const nextItem = toProcess[i + 1] ?? ctx.RCurly[0];
          if (!nextItem.location) nextItem.location = { startLine: nextItem.startLine, startColumn: nextItem.startColumn, endColumn: nextItem.endColumn }
          if (!item.location) item.location = { startLine: item.startLine, startColumn: item.startColumn, endColumn: item.endColumn }
          
          if (selection
            && vscode.window.activeTextEditor?.document.uri.fsPath === parent.file.name
            && selection.isBefore(new vscode.Position(nextItem.location.startLine - parent.file.startLine - 1, nextItem.location.startColumn))
            && selection.isAfterOrEqual(new vscode.Position(item.location.startLine - parent.file.startLine - 1, item.location.endColumn))) {
              this.completionItems = [...builtins.cmds, ...builtins.globals, ...this.defines, ...scope.getAllIdents()];
          }
        }
      }
      if (toProcess.length == 0) {
        // @ts-ignore
        const item = ctx.LCurly[0];
        // @ts-ignore
        const nextItem = ctx.RCurly[0];

        if (!nextItem.location) nextItem.location = { startLine: nextItem.startLine, startColumn: nextItem.startColumn, endColumn: nextItem.endColumn }
        if (!item.location) item.location = { startLine: item.startLine, startColumn: item.startColumn, endColumn: item.endColumn }

        if (selection
          && vscode.window.activeTextEditor?.document.uri.fsPath === parent.file.name
          && selection.isBefore(new vscode.Position(nextItem.location.startLine - parent.file.startLine - 1, nextItem.location.startColumn))
          && selection.isAfterOrEqual(new vscode.Position(item.location.startLine - parent.file.startLine - 1, item.location.endColumn))) {
            this.completionItems = [...builtins.cmds, ...builtins.globals, ...this.defines, ...scope.getAllIdents()];
        }
      }
      
      const finisher = getBuiltinByName('Return');
      scope.rawValues.push(0);
      finisher.arguments.push({ 
        kind: 'number',
        id: scope.rawValues.length - 1,
        value: 0
      });
      finisher.arguments.push({ 
        kind: 'raw',
        id: callType.SCOPE,
        value: 0
      });
      scope.commands.push(finisher);
      return scope;
    }
  }

  return CustomVisitor;
}