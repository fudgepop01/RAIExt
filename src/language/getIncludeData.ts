import * as vscode from 'vscode';
import { sep } from 'path';
import { readdir, readFile } from 'fs/promises';
import { promisify } from 'util';
import { IFuncDef, IVariable } from './definitions';

export interface IBuiltins {
  cmds: IFuncDef[];
  globals: IVariable[];
}
export const loadBuiltins = async (): Promise<IBuiltins> => {
  const includePath: string = vscode.workspace.getConfiguration("rai").get("builtinpath") as string;
  const out: IBuiltins = {
    cmds: [],
    globals: []
  }

  let defFile: string;
  try {
    defFile = await readFile(includePath, "utf8");
  } catch {
    return out;
  }
  
  const lines = defFile.split(/\r?\n/g);
  // console.log(lines);
  let idx = 0;
  for (const line of lines) {
    if (line.startsWith("glob")) {
      const matchResult = line.match(/glob (?<name>\w+)\s*:\s*((0x(?<raw>[0-9a-fA-F]+))|(\.\.))/)
      if (matchResult?.groups!.raw) idx = parseInt(matchResult?.groups!.raw!, 16);

      out.globals.push({
        name: matchResult!.groups!.name!,
        file: { name: "builtins", startLine: -1 },
        location: {
          startLine: -1,
          file: "builtins"
        },
        raw: idx,
        idKind: "global"
      })
      idx += 1;
    } else if (line.startsWith("cmd")) {
      const matchResult = line.match(/cmd (?<name>\w+)\s*:\s*((0x(?<raw>[0-9a-fA-F]+))|(\.\.))\s*(?<args>.+)?/)
      if (matchResult?.groups!.raw) idx = parseInt(matchResult?.groups!.raw!, 16);

      // console.log(matchResult?.groups!);
      out.cmds.push({
        depth: -1,
        name: matchResult!.groups!.name!,
        file: { name: "builtins", startLine: -1 },
        location: {
          startLine: -1,
          file: "builtins"
        },
        idKind: "scriptDef",
        raw: idx,
        getArgCount() { return this.arguments.length; },
        getAllIdents() { return [] },
        getAllVars() { return [] },
        arguments: matchResult!.groups!.args ? matchResult!.groups!.args!.split(/\s+/g).map(val => ({
          name: val,
          file: { name: "builtins", startLine: -1 },
          location: {
            startLine: -1,
            file: "builtins"
          },
          idKind: "arg"
        })) : []
      })
      idx += 1;
    }
  }
  // console.log(out);
  return out;
}