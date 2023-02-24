import { CstNode, IToken } from "@chevrotain/types";

export interface ILocation {
  file: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface IFileIdent {
  name: string;
  startLine: number;
}

export type identKind = "global" | "arg" | "funcDef" | "scriptDef" | "variable" | "define";
export interface IIdentifier {
  idKind: identKind;
  file: IFileIdent;
  name: string;
  location: ILocation;
}

export type IVariable = {
  raw?: number;
} & IIdentifier;

export interface IVarInitInfo {
  variable: IVariable;
  initializeOnly: boolean
  expression?: IExpression;
}

export interface IStr {
  content: string;
}

export interface IRawValue {
  value: number;
}

export type IDefined = {
  file: IFileIdent;
  name: string;
  text: string;
  expanded?: string;
  node?: CstNode;
} & IIdentifier;

export enum Operator {
  OR,
  AND,
  BOR,
  BXOR,
  BAND,
  EQ,
  NEQ,
  GR,
  GEQ,
  LES,
  LEQ,
  BSL,
  BSR,
  ADD,
  SUB,
  MUL,
  DIV,
  MOD,
  NOT
}
export interface IExpression {
  op: Operator;
  lhs: PassedArg;
  rhs: PassedArg;
}

export enum callType {
  SCOPE,
  FUNCTION,
  SCRIPT,
  LOOP
}
export type argKinds = 'string' | 'number' | 'function' | 'identifier' | 'builtin' | 'script' | 'expression' | 'raw' | 'builtin-rel';
export type PassedArg = { kind: argKinds; id: number; } & (IVariable | IStr | IFuncCall | IRawValue | IExpression);

export type FnCallKind = 'builtin' | 'script' | 'function'
export interface IFuncCall {
  kind: FnCallKind;
  name: string;
  arguments: PassedArg[];
  id: number;
}

export interface ICommand {
  name: string;
  arguments: PassedArg[];
}

export interface IScope {
  file: IFileIdent;
  scopeDepth: number;
  depth: number;
  variables: IVariable[];
  parent: IScope | IScript;
  commands: IFuncCall[];
  rawValues: number[];
  rawStrings: string[];
  getAllIdents(): IIdentifier[];
  getAllVars(): IVariable[];
}

export type Arguments = { refCount?: number } & IVariable[]

export type IScript = {
  arguments: Arguments;
  scope?: IScope;
  getAllIdents(): IIdentifier[];
  getAllVars(): IVariable[];
  getArgCount(): number;
  depth: number;
  scopeCtx?: CstNode;
} & IIdentifier;

export type IFuncDef = {
    raw?: number;
} & IScript;