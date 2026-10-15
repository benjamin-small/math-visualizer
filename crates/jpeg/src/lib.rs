//! The parts of baseline JPEG, one pure function per stage, each with its
//! inverse. `codec` composes them into a JFIF encoder and decoder; everything
//! else is usable on its own for small experiments (one block, one table, one
//! Huffman code).

pub mod blocks;
pub mod color;
pub mod error;
pub mod image;
pub mod sampling;

pub use error::JpegError;
pub use image::{Block, Component, Plane, QBlock, Rgb8Image, Subsampling, Table};
