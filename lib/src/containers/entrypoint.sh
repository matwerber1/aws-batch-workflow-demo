#!/bin/bash

BASENAME="${0##*/}"

# Standard function to print an error and exit with a failing return code
error_exit () {
  echo "${BASENAME} - ${1}" >&2
  exit 1
}

trap 'cleanup' EXIT HUP INT QUIT TERM

printenv
echo
echo

node index.js "$@"